import { motion } from 'framer-motion'

interface Book { id: number; title: string; author: string; color: string; textColor?: string }
const bookCovers: Book[] = [
  { id: 1, title: 'THE GREAT NOVEL', author: 'Classic Tales', color: '#8B4513', textColor: 'white' },
  { id: 2, title: 'CRIME & MYSTERY', author: 'Detective Stories', color: '#1a237e', textColor: 'white' },
  { id: 3, title: 'ROMANCE', author: 'Love Stories', color: '#c2185b', textColor: 'white' },
  { id: 4, title: 'SCI-FI', author: 'Future Worlds', color: '#00838f', textColor: 'white' },
  { id: 5, title: 'FANTASY', author: 'Epic Tales', color: '#4a148c', textColor: 'white' },
  { id: 6, title: 'THRILLER', author: 'Page Turners', color: '#b71c1c', textColor: 'white' },
  { id: 7, title: 'HISTORY', author: 'Past Lives', color: '#bf360c', textColor: 'white' },
  { id: 8, title: 'BIOGRAPHY', author: 'True Stories', color: '#1b5e20', textColor: 'white' },
  { id: 9, title: 'POETRY', author: 'Verse', color: '#311b92', textColor: 'white' },
  { id: 10, title: 'ADVENTURE', author: 'Journeys', color: '#004d40', textColor: 'white' },
  { id: 11, title: 'HORROR', author: 'Dark Tales', color: '#000000', textColor: 'white' },
  { id: 12, title: 'COMEDY', author: 'Humor', color: '#f57f17', textColor: 'black' },
  { id: 13, title: 'DRAMA', author: 'Life Stories', color: '#263238', textColor: 'white' },
  { id: 14, title: 'CLASSICS', author: 'Timeless', color: '#3e2723', textColor: 'white' },
  { id: 15, title: 'YOUNG ADULT', author: 'Teen Reads', color: '#e91e63', textColor: 'white' },
  { id: 16, title: 'CHILDREN', author: 'Kids Books', color: '#4caf50', textColor: 'white' },
  { id: 17, title: 'COOKING', author: 'Recipes', color: '#ff6f00', textColor: 'white' },
  { id: 18, title: 'TRAVEL', author: 'Explore', color: '#0277bd', textColor: 'white' },
  { id: 19, title: 'ART', author: 'Creative', color: '#6a1b9a', textColor: 'white' },
  { id: 20, title: 'SELF-HELP', author: 'Growth', color: '#00796b', textColor: 'white' },
]

export default function BookGrid() {
  const row1 = bookCovers.slice(0, 10)
  const row2 = bookCovers.slice(10, 20)
  const Card = ({ book }: { book: Book }) => (
    <div className="aspect-[2/3] rounded-lg shadow-lg transition-transform duration-300 hover:scale-110 hover:shadow-2xl hover:z-10 relative flex items-center justify-center p-3 md:p-4 cursor-default" style={{ backgroundColor: book.color, width: 120 }}>
      <div className="text-center">
        <div className="text-[8px] md:text-xs mb-1" style={{ fontWeight: 700, color: book.textColor, lineHeight: 1.2 }}>{book.title}</div>
        <div className="text-[6px] md:text-[10px]" style={{ fontWeight: 500, color: book.textColor, opacity: 0.8 }}>{book.author}</div>
      </div>
    </div>
  )
  const Track = ({ items, delay }: { items: Book[]; delay: number }) => (
    <div className="marquee-row marquee-mask">
      <motion.div className="marquee-track" initial={{ x: '0%' }} animate={{ x: ['0%', '-50%'] }} transition={{ duration: 55, ease: 'linear', repeat: Infinity, delay }}>
        {items.map((b) => <Card key={`a-${b.id}`} book={b} />)}
        {items.map((b) => <Card key={`b-${b.id}`} book={b} />)}
      </motion.div>
    </div>
  )
  return (
    <div className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div initial={{ y: 60, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="text-center mb-16">
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-6" style={{ fontWeight: 700, lineHeight: 1.1 }}>A library you'll want</h2>
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-8" style={{ fontWeight: 700, lineHeight: 1.1 }}>to get lost in.</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">With millions of titles across every genre, there's something for everyone. Discover bestsellers, classics, and hidden gems curated just for you.</p>
        </motion.div>
        <motion.div initial={{ y: 80, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: 0.2 }} className="space-y-6">
          <Track items={row1} delay={0} />
          <Track items={row2} delay={0.8} />
        </motion.div>
      </div>
    </div>
  )
}