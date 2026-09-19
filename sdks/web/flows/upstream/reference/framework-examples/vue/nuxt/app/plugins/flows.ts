import { defineNuxtPlugin } from "nuxt/app";
import { defineCustomElement } from "vue";

import { init } from "@superboard/flows-js";
import { setupJsComponents } from "@superboard/flows-js-components";
import * as components from "@superboard/flows-js-components/components";
import * as tourComponents from "@superboard/flows-js-components/tour-components";
import * as surveyComponents from "@superboard/flows-js-components/survey-components";

// Don't forget to import the CSS styles for Flows components
import "@superboard/flows-js-components/index.css";

import VueBanner from "~/components/banner.vue";
import VueTourBanner from "~/components/tour-banner.vue";

const Banner = defineCustomElement(VueBanner);
const TourBanner = defineCustomElement(VueTourBanner);

export default defineNuxtPlugin({
  name: "flows",
  parallel: true,
  hooks: {
    "app:mounted"() {
      init({
        projectId: "YOUR_PROJECT_ID",
        userId: "YOUR_USER_ID",
        environment: "production",
        onNavigate: (href, event) => {
          event.preventDefault();

          navigateTo(href);
        },
      });
      setupJsComponents({
        components: {
          ...components,
          // Example of custom "Banner" component
          Banner: Banner,
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
    },
  },
});
