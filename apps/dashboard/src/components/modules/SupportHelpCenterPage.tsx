"use client";

import { useState } from "react";
import { BookOpen, Globe2, Languages, Plus, Send } from "lucide-react";
import {
  publishSupportArticle,
  supportArticles,
  supportCategories,
  supportFolders,
  supportPortals,
  supportTranslations,
} from "@/api/support/helpCenterService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { EmptyProject, ModulePage, moduleErrorMessage } from "./ModulePage";
import {
  SupportEmpty,
  SupportError,
  SupportLoadMore,
  SupportLoading,
  SupportSearchToolbar,
  SupportStatus,
  useSupportCollection,
} from "@/components/support/SupportUi";

export default function SupportHelpCenterPage() {
  const { selectedProject } = useProjectSelection();
  const projectRef = selectedProject?.id;
  const portals = useSupportCollection(projectRef, supportPortals.list);
  const categories = useSupportCollection(projectRef, supportCategories.list);
  const folders = useSupportCollection(projectRef, supportFolders.list);
  const articles = useSupportCollection(projectRef, supportArticles.list);
  const translations = useSupportCollection(
    projectRef,
    supportTranslations.list,
    { searchable: false }
  );
  const [saving, setSaving] = useState(false);
  const [portal, setPortal] = useState({
    name: "",
    slug: "",
    locale: "en",
    domain: "",
  });
  const [category, setCategory] = useState({
    portalId: "",
    name: "",
    slug: "",
    description: "",
  });
  const [folder, setFolder] = useState({
    portalId: "",
    categoryId: "",
    name: "",
    slug: "",
  });
  const [article, setArticle] = useState({
    portalId: "",
    categoryId: "",
    folderId: "",
    title: "",
    slug: "",
    excerpt: "",
    content: "",
  });
  const [translation, setTranslation] = useState({
    articleId: "",
    locale: "fr",
    title: "",
    content: "",
  });

  const create = async (
    kind: "portal" | "category" | "folder" | "article" | "translation"
  ) => {
    if (!projectRef) return;
    setSaving(true);
    try {
      if (kind === "portal") {
        await supportPortals.create(projectRef, {
          name: required(portal.name),
          slug: slug(portal.slug || portal.name),
          locale: required(portal.locale),
          status: "draft",
          custom_domain: portal.domain.trim() || null,
          settings: {},
        });
        setPortal({ name: "", slug: "", locale: "en", domain: "" });
        await portals.reload();
      } else if (kind === "category") {
        await supportCategories.create(projectRef, {
          portal_id: required(category.portalId),
          name: required(category.name),
          slug: slug(category.slug || category.name),
          description: category.description.trim() || null,
          position: 0,
          status: "draft",
        });
        setCategory((current) => ({
          ...current,
          name: "",
          slug: "",
          description: "",
        }));
        await categories.reload();
      } else if (kind === "folder") {
        await supportFolders.create(projectRef, {
          portal_id: required(folder.portalId),
          category_id: required(folder.categoryId),
          name: required(folder.name),
          slug: slug(folder.slug || folder.name),
          description: null,
          position: 0,
          status: "draft",
        });
        setFolder((current) => ({ ...current, name: "", slug: "" }));
        await folders.reload();
      } else if (kind === "article") {
        await supportArticles.create(projectRef, {
          portal_id: required(article.portalId),
          category_id: article.categoryId.trim() || null,
          folder_id: article.folderId.trim() || null,
          title: required(article.title),
          slug: slug(article.slug || article.title),
          excerpt: article.excerpt.trim() || null,
          content: required(article.content),
          status: "draft",
          author_id: "dashboard",
        });
        setArticle((current) => ({
          ...current,
          title: "",
          slug: "",
          excerpt: "",
          content: "",
        }));
        await articles.reload();
      } else {
        await supportTranslations.create(projectRef, {
          article_id: required(translation.articleId),
          locale: required(translation.locale),
          title: required(translation.title),
          excerpt: null,
          content: required(translation.content),
          status: "draft",
        });
        setTranslation((current) => ({ ...current, title: "", content: "" }));
        await translations.reload();
      }
      showSuccessNotification(
        `${kind.charAt(0).toUpperCase()}${kind.slice(1)} saved`
      );
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const publish = async (id: string) => {
    if (!projectRef) return;
    try {
      await publishSupportArticle(projectRef, id);
      await articles.reload();
      showSuccessNotification("Article published and queued for indexing");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  return (
    <ModulePage
      title="Help Center"
      description="Author, translate, publish and index customer self-service content."
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <Tabs defaultValue="articles">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="articles">Articles</TabsTrigger>
            <TabsTrigger value="structure">Structure</TabsTrigger>
            <TabsTrigger value="portals">Portals</TabsTrigger>
            <TabsTrigger value="translations">Translations</TabsTrigger>
          </TabsList>
          <TabsContent className="space-y-4" value="articles">
            <Toolbar collection={articles} />
            <SupportError message={articles.error} />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen /> New article
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Portal">
                  <ResourceSelect
                    value={article.portalId}
                    onChange={(portalId) =>
                      setArticle((v) => ({ ...v, portalId }))
                    }
                    items={portals.items}
                    placeholder="Select portal"
                  />
                </Field>
                <Field label="Category">
                  <ResourceSelect
                    value={article.categoryId}
                    onChange={(categoryId) =>
                      setArticle((v) => ({ ...v, categoryId }))
                    }
                    items={categories.items}
                    placeholder="No category"
                  />
                </Field>
                <Field label="Folder">
                  <ResourceSelect
                    value={article.folderId}
                    onChange={(folderId) =>
                      setArticle((v) => ({ ...v, folderId }))
                    }
                    items={folders.items}
                    placeholder="No folder"
                  />
                </Field>
                <Field label="Slug">
                  <Input
                    placeholder="automatic-from-title"
                    value={article.slug}
                    onChange={(e) =>
                      setArticle((v) => ({ ...v, slug: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Title">
                  <Input
                    value={article.title}
                    onChange={(e) =>
                      setArticle((v) => ({ ...v, title: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Excerpt">
                  <Input
                    value={article.excerpt}
                    onChange={(e) =>
                      setArticle((v) => ({ ...v, excerpt: e.target.value }))
                    }
                  />
                </Field>
                <div className="space-y-2 md:col-span-2 xl:col-span-4">
                  <Label>Article content</Label>
                  <Textarea
                    rows={9}
                    value={article.content}
                    onChange={(e) =>
                      setArticle((v) => ({ ...v, content: e.target.value }))
                    }
                  />
                </div>
                <div className="flex justify-end md:col-span-2 xl:col-span-4">
                  <Button
                    disabled={saving}
                    onClick={() => void create("article")}
                  >
                    <Plus /> Save draft
                  </Button>
                </div>
              </CardContent>
            </Card>
            <ArticleList
              loading={articles.loading}
              items={articles.items}
              onPublish={publish}
            />
            <SupportLoadMore
              visible={articles.hasMore}
              loading={articles.loadingMore}
              onClick={articles.loadMore}
            />
          </TabsContent>
          <TabsContent className="space-y-6" value="structure">
            <div className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">New category</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Portal">
                    <ResourceSelect
                      value={category.portalId}
                      onChange={(portalId) =>
                        setCategory((v) => ({ ...v, portalId }))
                      }
                      items={portals.items}
                      placeholder="Select portal"
                    />
                  </Field>
                  <Field label="Name">
                    <Input
                      value={category.name}
                      onChange={(e) =>
                        setCategory((v) => ({ ...v, name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      value={category.slug}
                      onChange={(e) =>
                        setCategory((v) => ({ ...v, slug: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Description">
                    <Input
                      value={category.description}
                      onChange={(e) =>
                        setCategory((v) => ({
                          ...v,
                          description: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Button
                    disabled={saving}
                    onClick={() => void create("category")}
                  >
                    <Plus /> Add category
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">New folder</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Field label="Portal">
                    <ResourceSelect
                      value={folder.portalId}
                      onChange={(portalId) =>
                        setFolder((v) => ({ ...v, portalId }))
                      }
                      items={portals.items}
                      placeholder="Select portal"
                    />
                  </Field>
                  <Field label="Category">
                    <ResourceSelect
                      value={folder.categoryId}
                      onChange={(categoryId) =>
                        setFolder((v) => ({ ...v, categoryId }))
                      }
                      items={categories.items}
                      placeholder="Select category"
                    />
                  </Field>
                  <Field label="Name">
                    <Input
                      value={folder.name}
                      onChange={(e) =>
                        setFolder((v) => ({ ...v, name: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Slug">
                    <Input
                      value={folder.slug}
                      onChange={(e) =>
                        setFolder((v) => ({ ...v, slug: e.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    disabled={saving}
                    onClick={() => void create("folder")}
                  >
                    <Plus /> Add folder
                  </Button>
                </CardContent>
              </Card>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {categories.items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="flex justify-between p-4">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        /{item.slug}
                      </p>
                    </div>
                    <SupportStatus value={item.status} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent className="space-y-4" value="portals">
            <Toolbar collection={portals} />
            <SupportError message={portals.error} />
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe2 /> New portal
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Name">
                  <Input
                    value={portal.name}
                    onChange={(e) =>
                      setPortal((v) => ({ ...v, name: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Slug">
                  <Input
                    placeholder="automatic-from-name"
                    value={portal.slug}
                    onChange={(e) =>
                      setPortal((v) => ({ ...v, slug: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Default locale">
                  <Input
                    value={portal.locale}
                    onChange={(e) =>
                      setPortal((v) => ({ ...v, locale: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Custom domain">
                  <Input
                    placeholder="help.example.com"
                    value={portal.domain}
                    onChange={(e) =>
                      setPortal((v) => ({ ...v, domain: e.target.value }))
                    }
                  />
                </Field>
                <div className="flex justify-end md:col-span-2 xl:col-span-4">
                  <Button
                    disabled={saving}
                    onClick={() => void create("portal")}
                  >
                    <Plus /> Create portal
                  </Button>
                </div>
              </CardContent>
            </Card>
            {portals.loading ? (
              <SupportLoading />
            ) : portals.items.length === 0 ? (
              <SupportEmpty
                title="No Help Center portals"
                description="Create a branded portal for public Support documentation."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {portals.items.map((item) => (
                  <Card key={item.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          /{item.slug} · {item.locale}
                        </p>
                      </div>
                      <SupportStatus value={item.status} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent className="space-y-4" value="translations">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Languages /> New translation
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Article">
                  <ResourceSelect
                    value={translation.articleId}
                    onChange={(articleId) =>
                      setTranslation((v) => ({ ...v, articleId }))
                    }
                    items={articles.items}
                    placeholder="Select article"
                    titleKey="title"
                  />
                </Field>
                <Field label="Locale">
                  <Input
                    value={translation.locale}
                    onChange={(e) =>
                      setTranslation((v) => ({ ...v, locale: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Translated title">
                  <Input
                    value={translation.title}
                    onChange={(e) =>
                      setTranslation((v) => ({ ...v, title: e.target.value }))
                    }
                  />
                </Field>
                <div className="space-y-2 md:col-span-2">
                  <Label>Translated content</Label>
                  <Textarea
                    rows={8}
                    value={translation.content}
                    onChange={(e) =>
                      setTranslation((v) => ({ ...v, content: e.target.value }))
                    }
                  />
                </div>
                <div className="flex justify-end md:col-span-2">
                  <Button
                    disabled={saving}
                    onClick={() => void create("translation")}
                  >
                    <Plus /> Save translation
                  </Button>
                </div>
              </CardContent>
            </Card>
            {translations.items.length === 0 ? (
              <SupportEmpty
                title="No article translations"
                description="Add localized versions after creating an article."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {translations.items.map((item) => (
                  <Card key={String(item.id)}>
                    <CardContent className="flex justify-between p-4">
                      <div>
                        <p className="font-medium">
                          {String(item.title || "Translation")}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {String(item.locale || "")}
                        </p>
                      </div>
                      <SupportStatus value={String(item.status || "draft")} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </ModulePage>
  );
}

type Named = { id: string; name?: string; title?: string };
function ResourceSelect({
  value,
  onChange,
  items,
  placeholder,
  titleKey = "name",
}: {
  value: string;
  onChange: (value: string) => void;
  items: Named[];
  placeholder: string;
  titleKey?: "name" | "title";
}) {
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{placeholder}</option>
      {items.map((item) => (
        <option key={item.id} value={item.id}>
          {item[titleKey] || item.id}
        </option>
      ))}
    </select>
  );
}
function Toolbar({
  collection,
}: {
  collection: ReturnType<typeof useSupportCollection<Named>>;
}) {
  return (
    <SupportSearchToolbar
      query={collection.query}
      setQuery={collection.setQuery}
      onSearch={collection.search}
      onRefresh={collection.reload}
      loading={collection.loading}
    />
  );
}
function ArticleList({
  loading,
  items,
  onPublish,
}: {
  loading: boolean;
  items: Array<{
    id: string;
    title: string;
    excerpt?: string | null;
    slug: string;
    status: string;
  }>;
  onPublish: (id: string) => void;
}) {
  if (loading) return <SupportLoading />;
  if (!items.length)
    return (
      <SupportEmpty
        title="No Help Center articles"
        description="Write an article to build your searchable knowledge base."
      />
    );
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <Card key={item.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">
                /{item.slug} · {item.excerpt || "No excerpt"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SupportStatus value={item.status} />
              {item.status !== "published" ? (
                <Button onClick={() => onPublish(item.id)}>
                  <Send /> Publish
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function required(value: string) {
  const result = value.trim();
  if (!result) throw new Error("Complete all required fields");
  return result;
}
function slug(value: string) {
  const result = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!result) throw new Error("A valid slug is required");
  return result;
}
