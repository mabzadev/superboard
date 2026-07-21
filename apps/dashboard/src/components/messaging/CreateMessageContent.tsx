import EditorPage from "../craft/Editor";

const CreateMessageContent = ({
  setHtmlMessage,
  htmlMessage,
  readOnlyMode,
}: {
  htmlMessage: string | null;
  setHtmlMessage: (html: string) => void;
  readOnlyMode?: boolean;
}) => {
  return (
    <EditorPage
      htmlMessage={htmlMessage}
      setHtmlMessage={setHtmlMessage}
      readOnlyMode={readOnlyMode}
    />
  );
};

export default CreateMessageContent;
