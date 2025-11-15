type Props = { title: string; downloadUrl?: string }
export default function BookCard({ title, downloadUrl }: Props) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
      <div style={{ fontWeight: 600 }}>{title}</div>
      {downloadUrl && (
        <a href={downloadUrl} target="_blank" rel="noreferrer" style={{ marginTop: 8, display: 'inline-block' }}>下载</a>
      )}
    </div>
  )
}