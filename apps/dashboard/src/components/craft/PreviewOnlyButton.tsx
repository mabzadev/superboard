import { Button } from "../ui/button";

export const PreviewOnlyButton = ({
  htmlMessage,
  onPreview,
}: {
  htmlMessage: string | null;
  onPreview: (html: string) => void;
}) => {
  const handlePreview = () => {
    if (htmlMessage) {
      onPreview(htmlMessage);
    }
  };

  return (
    <Button variant={"secondary"} onClick={handlePreview}>
      Preview
    </Button>
  );
};
