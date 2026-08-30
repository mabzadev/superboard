import type { QuestionType } from "@superboard/flows-product-types";

export const surveyQuestionTypeTranslation: Record<QuestionType, string> = {
  freeform: "Freeform",
  "single-choice": "Single choice",
  "multiple-choice": "Multiple choice",
  rating: "Rating",
  link: "Link",
  "end-screen": "End screen",
};
