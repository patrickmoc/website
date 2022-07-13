import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Map as MapDB, MapTrack } from '@prisma/client';
import { CreateMapDto, MapDto } from '../../@common/dto/map/map.dto';
import { PaginatedResponseDto } from '../../@common/dto/paginated-response.dto';
import { MapCreateRequireInfoAndTracks, MapsRepoService } from '../repo/maps-repo.service';
import { AuthService } from '../auth/auth.service';
import { MapCreditType, MapStatus, MapType } from '../../@common/enums/map.enum';
import { FileStoreCloudService } from '../filestore/file-store-cloud.service';
import { DtoFactory, ExpandToPrismaIncludes } from '../../@common/utils/dto.utility';
import { UsersRepoService } from '../repo/users-repo.service';
import { ActivityTypes } from '../../@common/enums/activity.enum';

@Injectable()
export class MapsService {
    constructor(
        private readonly authService: AuthService,
        private readonly mapRepo: MapsRepoService,
        private readonly userRepo: UsersRepoService,
        private readonly fileCloudService: FileStoreCloudService
    ) {}

    //#region Maps

    async getAll(
        userID: number,
        skip: number,
        take: number,
        expand?: string[],
        search?: string,
        submitterID?: number,
        type?: MapType,
        difficultyLow?: number,
        difficultyHigh?: number,
        isLinear?: boolean
    ): Promise<PaginatedResponseDto<MapDto>> {
        // Old API has some stuff for "status" and "statusNot" and "priority" but isn't in docs or validations or
        // used anywhere in client/game, leaving for now.

        // Where
        const where: Prisma.MapWhereInput = {};
        if (search) where.name = { startsWith: search };
        if (submitterID) where.submitterID = submitterID;
        if (type) where.type = type;

        if (difficultyHigh && difficultyLow)
            where.mainTrack = { is: { difficulty: { lt: difficultyHigh, gt: difficultyLow } } };
        else if (difficultyLow) where.mainTrack = { is: { difficulty: { gt: difficultyLow } } };
        else if (difficultyHigh) where.mainTrack = { is: { difficulty: { lt: difficultyHigh } } };

        // If we have difficulty filters we have to construct quite a complicated filter...
        if (isLinear)
            where.mainTrack = where.mainTrack ? { is: { ...where.mainTrack.is, isLinear: true } } : { isLinear: true };

        // Include
        const include: Prisma.MapInclude = {
            mainTrack: true,
            info: true,
            ...ExpandToPrismaIncludes(expand?.filter((x) => ['credits', 'thumbnail'].includes(x)))
        };

        const incPB = expand?.includes('personalBest');
        const incWR = expand?.includes('worldRecord');

        MapsService.handleMapGetIncludes(
            include,
            userID,
            expand?.includes('inFavorites'),
            expand?.includes('inLibrary'),
            incPB,
            incWR
        );

        // Order
        const order: Prisma.MapOrderByWithRelationInput = { createdAt: 'desc' };

        const dbResponse = await this.mapRepo.getAll(where, include, order, skip, take);

        if (incPB || incWR) {
            dbResponse[0].forEach((map) => MapsService.handleMapGetPrismaResponse(map, userID, incPB, incWR));
        }

        return new PaginatedResponseDto(MapDto, dbResponse);
    }

    async get(mapID: number, userID: number, expand: string[]): Promise<MapDto> {
        const include: Prisma.MapInclude = ExpandToPrismaIncludes(
            expand?.filter((x) =>
                ['info', 'credits', 'submitter', 'images', 'thumbnail', 'stats', 'tracks'].includes(x)
            )
        );

        const incPB = expand?.includes('personalBest');
        const incWR = expand?.includes('worldRecord');

        MapsService.handleMapGetIncludes(
            include,
            userID,
            expand?.includes('inFavorites'),
            expand?.includes('inLibrary'),
            incPB,
            incWR
        );

        const dbResponse = await this.mapRepo.get(mapID, include);

        if (!dbResponse) throw new NotFoundException('Map not found');

        if (incPB || incWR) {
            MapsService.handleMapGetPrismaResponse(dbResponse, userID, incPB, incWR);
        }

        return DtoFactory(MapDto, dbResponse);
    }

    async create(mapCreateDto: CreateMapDto, submitterID: number): Promise<number> {
        // Check there's no map with same name
        const existingMaps: number = await this.mapRepo.count({
            name: mapCreateDto.name,
            NOT: {
                statusFlag: {
                    in: [MapStatus.REJECTED, MapStatus.REMOVED]
                }
            }
        });

        if (existingMaps > 0) throw new ConflictException('Map with this name already exists');

        // Limit the number of pending maps a user can have at any one time
        // TODO: Move this out to a config file
        const mapUploadLimit = 5;
        const submittedMaps: number = await this.mapRepo.count({
            submitterID: submitterID,
            statusFlag: {
                in: [MapStatus.PENDING, MapStatus.NEEDS_REVISION]
            }
        });

        if (submittedMaps >= mapUploadLimit)
            throw new ConflictException(`You can't have more than ${mapUploadLimit} maps pending at once`);

        // Extra checks...
        // TODO: There's probs loads of these we could do, and with map submission incoming that's desirable, could be a good task for a new dev.
        const trackNums = mapCreateDto.tracks.map((track) => track.trackNum);
        // Set construction ensures uniqueness, so just compare the lengths
        if (trackNums.length !== new Set(trackNums).size)
            throw new BadRequestException('All map tracks must have unique track numbers');

        // Actually build our input. Prisma doesn't let you do nested createMany (https://github.com/prisma/prisma/issues/5455)
        // so we have to do it in parts... Fortunately this doesnt't run often.
        const createInput: MapCreateRequireInfoAndTracks = {
            submitter: { connect: { id: submitterID } },
            name: mapCreateDto.name,
            type: mapCreateDto.type,
            stats: { create: {} }, // Just init empty entry
            statusFlag: MapStatus.NEEDS_REVISION,
            info: {
                create: {
                    numTracks: mapCreateDto.info.numTracks,
                    description: mapCreateDto.info.description,
                    creationDate: mapCreateDto.info.creationDate,
                    youtubeID: mapCreateDto.info.youtubeID
                }
            },
            credits: {
                createMany: {
                    data: mapCreateDto.credits.map((credit) => {
                        return {
                            type: credit.type,
                            userID: credit.userID
                        };
                    })
                }
            },
            tracks: {
                createMany: {
                    data: mapCreateDto.tracks.map((track): Prisma.MapTrackCreateManyMapInput => {
                        return {
                            isLinear: track.isLinear,
                            numZones: track.numZones,
                            trackNum: track.trackNum,
                            difficulty: track.difficulty
                        };
                    })
                }
            }
        };

        const mapDB: any = await this.mapRepo.create(createInput);

        await Promise.all(
            mapDB.tracks.map(async (track: MapTrack) => {
                const dtoTrack = mapCreateDto.tracks.find((dtoTrack) => dtoTrack.trackNum === track.trackNum);

                await this.mapRepo.updateMapTrack({ id: track.id }, { stats: { create: {} } }); // Init empty MapTrackStats entry

                await Promise.all(
                    dtoTrack.zones.map(async (zone) => {
                        const zoneDB: any = await this.mapRepo.createMapZone({
                            track: { connect: { id: track.id } },
                            zoneNum: zone.zoneNum,
                            stats: {
                                create: {}
                            }
                        });

                        // We could do a `createMany` for the triggers in the above input but we then need to attach a
                        // `MapZoneTriggerProperties` to each using the DTO properties, and I'm not certain the data we
                        // get back from the `createMany` is in the order we inserted. For tracks we use the find w/
                        // `trackNum` above, but `MapZoneTriggerProperties` don't have any distinguishing features like that.
                        // So I'm doing the triggers with looped `create`s so I can include the `MapZoneTriggerProperties`.
                        // Hopefully `MapZoneTriggerProperties` will be removed in 0.10.0 anyway (they're stupid) in which
                        // case we should be able to use a `createMany` for the triggers.
                        await Promise.all(
                            zone.triggers.map(async (trigger) => {
                                await this.mapRepo.createMapZoneTrigger({
                                    zone: {
                                        connect: {
                                            id: zoneDB.id
                                        }
                                    },
                                    type: trigger.type,
                                    pointsHeight: trigger.pointsHeight,
                                    pointsZPos: trigger.pointsZPos,
                                    points: trigger.points,
                                    properties: {
                                        create: {
                                            properties: trigger.properties.properties
                                        }
                                    }
                                });
                            })
                        );
                    })
                );
            })
        );

        // Create MAP_UPLOADED activities for each author
        await this.userRepo.createActivities(
            mapDB.credits
                .filter((credit) => credit.type === MapCreditType.AUTHOR)
                .map((credit): Prisma.ActivityCreateManyInput => {
                    return {
                        type: ActivityTypes.MAP_UPLOADED,
                        userID: credit.userID,
                        data: mapDB.id
                    };
                })
        );

        // Return the map ID to the controller so it can set it in the response header
        return mapDB.id;
    }

    //#endregion

    //#region Upload/Download

    async canUploadMap(mapID: number, userID: number): Promise<void> {
        const mapDB = await this.mapRepo.get(mapID);

        MapsService.uploadMapChecks(mapDB, userID);
    }

    async upload(mapID: number, userID: number, mapFileBuffer: Buffer): Promise<MapDto> {
        const mapDB = await this.mapRepo.get(mapID);

        MapsService.uploadMapChecks(mapDB, userID);

        const result = await this.storeMapFile(mapFileBuffer, mapDB);

        const dbResponse = await this.mapRepo.update(mapDB.id, {
            statusFlag: MapStatus.PENDING,
            fileKey: result[0],
            hash: result[1]
        });

        return DtoFactory(MapDto, dbResponse);
    }

    //#endregion

    //#region Private

    private static handleMapGetIncludes(
        include: Prisma.MapInclude,
        userID: number,
        fav: boolean,
        lib: boolean,
        PB: boolean,
        WR: boolean
    ): void {
        if (fav) include.favorites = { where: { userID: userID } };
        if (lib) include.libraryEntries = { where: { userID: userID } };

        if (PB || WR) {
            include.ranks = { include: { run: true, user: true } };
            if (PB && WR) {
                include.ranks.where = { OR: [{ userID: userID }, { rank: 1 }] };
            } else if (PB) {
                include.ranks.where = { userID: userID };
            } else {
                include.ranks.where = { rank: 1 };
            }
        }
    }

    private static handleMapGetPrismaResponse(mapObj: any, userID: number, PB: boolean, WR: boolean): void {
        if (PB && WR) {
            mapObj.worldRecord = mapObj.ranks.find((r) => r.rank === 1);
            mapObj.personalBest = mapObj.ranks.find((r) => r.userID === userID);
        } else if (PB) {
            mapObj.personalBest = mapObj.ranks[0];
        } else {
            mapObj.worldRecord = mapObj.ranks[0];
        }
        delete mapObj.ranks;
    }

    private async storeMapFile(mapFileBuffer, mapModel): Promise<[url: string, hash: string]> {
        const fileKey = `maps/${mapModel.name}.bsp`;

        const result = await this.fileCloudService.storeFileCloud(mapFileBuffer, fileKey);

        return [result.fileKey, result.hash];
    }

    private static uploadMapChecks(map: MapDB, userID: number): void {
        if (!map) throw new NotFoundException('Map not found');

        if (userID !== map.submitterID) throw new ForbiddenException('You are not the submitter of this map');

        if (map.statusFlag !== MapStatus.NEEDS_REVISION)
            throw new ForbiddenException('Map file cannot be uploaded, the map is not accepting revisions');
    }

    //#endregion
}
