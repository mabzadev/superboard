import { inject, Injectable, Injector } from "@angular/core";
import { createCustomElement } from "@angular/elements";
import { Router } from "@angular/router";

import { init } from "@superboard/flows-js";
import { setupJsComponents } from "@superboard/flows-js-components";
import * as components from "@superboard/flows-js-components/components";
import * as tourComponents from "@superboard/flows-js-components/tour-components";
import * as surveyComponents from "@superboard/flows-js-components/survey-components";

// Don't forget to import the CSS styles for Flows components
import "@superboard/flows-js-components/index.css";

import { Banner as AngularBanner } from "./banner/banner";
import { TourBanner as AngularTourBanner } from "./tour-banner/tour-banner";

@Injectable({
  providedIn: "root",
})
export class FlowsService {
  private router = inject(Router);

  init(injector: Injector) {
    init({
      projectId: "YOUR_PROJECT_ID",
      userId: "YOUR_USER_ID",
      environment: "production",
      onNavigate: (href, event) => {
        event.preventDefault();

        this.router.navigateByUrl(href);
      },
    });

    const Banner = createCustomElement(AngularBanner, { injector });
    const TourBanner = createCustomElement(AngularTourBanner, { injector });

    setupJsComponents({
      components: {
        ...components,
        // Example of custom "Banner" component
        Banner,
      },
      tourComponents: {
        ...tourComponents,
        // Example of custom "Banner" component for tours
        Banner: TourBanner,
      },
      surveyComponents: {
        ...surveyComponents,
      },
    });
  }
}
