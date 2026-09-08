import { CollectionArt, Icon } from "./Icons";

export default function CollectionHeader({
  title,
  count,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  count: number | undefined;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="page-head collection-head">
      <div>
        <h1>
          {title}
          <span className="title-count">{count ?? "—"}</span>
        </h1>
        <p className="subtitle">{subtitle}</p>
      </div>
      <div className="page-actions">
        <CollectionArt />
        <button className="button primary" onClick={onAction}>
          <Icon name="plus" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
