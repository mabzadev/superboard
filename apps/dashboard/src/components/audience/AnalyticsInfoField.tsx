const AnalyticsInfoField = ({
  title,
  value,
}: {
  title: string;
  value: string;
}) => {
  return (
    <div className="flex flex-row text-sm items-center gap-2 border rounded-sm border-sidebar-border overflow-hidden">
      <div className="flex flex-1 bg-sidebar-border p-2">
        <p>{title}</p>
      </div>

      <div className="flex flex-1 p-2">
        <p className="font-semibold"> {value}</p>
      </div>
    </div>
  );
};

export default AnalyticsInfoField;
