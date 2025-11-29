type Props = {
  title: string;
  downloadUrl?: string;
  onClick?: () => void;
}

export default function BookCard({ title, downloadUrl, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      style={{
        border: '1px solid #eee',
        borderRadius: 8,
        padding: 12,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s'
      }}
      className="hover:shadow-md hover:border-blue-200"
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          style={{ marginTop: 8, display: 'inline-block' }}
          onClick={(e) => e.stopPropagation()} // Prevent card click when clicking download
        >
          下载
        </a>
      )}
    </div>
  )
}