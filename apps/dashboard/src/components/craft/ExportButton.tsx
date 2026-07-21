import { Editor, Frame, useEditor } from "@craftjs/core";
import { ButtonComponent } from "./Button";
import { TextComponent } from "./Text";
import { ContainerComponent } from "./Container";
import { RootContainer } from "./RootContainer";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageComponent } from "./Image";
import { Button } from "../ui/button";

export const ExportHtmlButton = ({
  setHtmlMessage,
  onPreview,
}: {
  htmlMessage: string | null;
  setHtmlMessage: (html: string) => void;
  onPreview: (html: string) => void;
}) => {
  const resolver = {
    ButtonComponent,
    TextComponent,
    ContainerComponent,
    RootContainer,
    ImageComponent,
  };

  const generateHtmlFromJson = (json: string) => {
    const content = renderToStaticMarkup(
      <Editor resolver={resolver} enabled={false}>
        <Frame data={json} />
      </Editor>
    );

    const html = `
    <!DOCTYPE html>
    <html lang="en" class="">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Exported Page</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body style="margin:0;padding:0;background:#fff">
        ${content}
      </body>

      <script id="craft-state" type="application/json">
        ${JSON.stringify(json).replace(/</g, "\\u003c")}
      </script>
    </html>
  `;
    return html;
  };

  const { query } = useEditor();

  const handlePreview = () => {
    const json = query.serialize();
    const html = generateHtmlFromJson(json);
    setHtmlMessage(html);
    onPreview(html);
  };

  return (
    <Button variant={"secondary"} onClick={handlePreview}>
      Preview
    </Button>
  );
};
