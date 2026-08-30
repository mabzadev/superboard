import {
  createSupportResource,
  deleteSupportResource,
  listSupportResource,
  postSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportPortal = SupportEntity & {
  name: string;
  slug: string;
  locale: string;
  status: "draft" | "published" | "disabled";
  custom_domain?: string | null;
};
export type SupportCategory = SupportEntity & {
  portal_id: string;
  name: string;
  slug: string;
  description?: string | null;
  position: number;
  status: "draft" | "published" | "archived";
};
export type SupportArticle = SupportEntity & {
  portal_id: string;
  category_id?: string | null;
  folder_id?: string | null;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  status: "draft" | "published" | "archived";
  published_at?: string | null;
};

const resource = <T>(path: string) => ({
  list: (projectRef: string, query?: SupportCursorQuery) =>
    listSupportResource<T>(projectRef, path, query),
  create: <TInput>(projectRef: string, input: TInput) =>
    createSupportResource<T, TInput>(projectRef, path, input),
  update: <TInput>(projectRef: string, id: string, input: TInput) =>
    updateSupportResource<T, TInput>(projectRef, path, id, input),
  remove: (projectRef: string, id: string) =>
    deleteSupportResource(projectRef, path, id),
});

export const supportPortals = resource<SupportPortal>("help-center/portals");
export const supportCategories = resource<SupportCategory>(
  "help-center/categories"
);
export const supportFolders = resource<SupportCategory>("help-center/folders");
export const supportArticles = resource<SupportArticle>("help-center/articles");
export const supportTranslations = resource<
  Record<string, unknown> & SupportEntity
>("help-center/translations");

export const publishSupportArticle = (projectRef: string, id: string) =>
  postSupportAction<SupportArticle>(
    projectRef,
    `help-center/articles/${encodeURIComponent(id)}/publish`
  );
