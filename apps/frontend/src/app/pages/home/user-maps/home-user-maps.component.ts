import { Component, OnInit } from '@angular/core';
import { MapStatus } from '@momentum/constants';
import { LocalUserService } from '@momentum/frontend/data';
import { SharedModule } from '../../../shared.module';

@Component({
  selector: 'm-home-user-maps',
  templateUrl: './home-user-maps.component.html',
  standalone: true,
  imports: [SharedModule]
})
export class HomeUserMapsComponent implements OnInit {
  protected readonly MapStatus = MapStatus;
  submittedMapStatusSummary;

  constructor(private userService: LocalUserService) {
    this.submittedMapStatusSummary = {};
  }

  ngOnInit() {
    this.userService.getSubmittedMapSummary().subscribe({
      next: (response) =>
        (this.submittedMapStatusSummary = Object.fromEntries(
          response.map((sum) => [sum.status, sum.statusCount])
        )),
      error: (error) => console.error(error)
    });
  }
}