export function NodeHeader({ title, onDelete }: { title: string; onDelete: () => void }) {
  return (
    <div className="node-header">
      <span className="node-kind">{title}</span>
      <button
        type="button"
        className="node-delete nodrag"
        onClick={onDelete}
        aria-label={`Удалить ноду «${title}»`}
      >
        ✕
      </button>
    </div>
  );
}
