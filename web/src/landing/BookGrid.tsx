import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

interface Book { id: number; title: string; author: string; image: string }

const filenames = [
  '光纤传感原理与技术-冯亭.jpg',
  '古典吉他基础大教程-王迪平.jpg',
  '嘘！别被老板知道-圈圈.jpg',
  '孙子兵法与三十六计-张辉力.jpg',
  '怎么办？-路易·阿尔都塞.jpg',
  '战后三部曲-沃尔夫冈·克彭.jpg',
  '梦先生-罗贝尔·潘热.jpg',
  '法国与晚清中国-葛夫平.jpg',
  '海洋微生物学(第三版)-张晓华.jpg',
  '知识的繁荣与危机-戴维·温伯格.jpg',
  '空衣橱-安妮·埃尔诺.jpg',
  '精密机械设计(第四版)-许贤泽.jpg',
  '纸上谈爱 _ 情书里的父母爱情-张冲波.jpg',
  '终始：社会学的民俗学（1926-1950）-岳永逸.jpg',
  '给麻风病人的吻（2025版）-弗朗索瓦·莫里亚克.jpg',
  '美国与晚清中国（1894～1911）-崔志海.jpg',
  '肌肉！肌肉！预防和逆转疾病，健康长寿的科学指南-加布里埃尔·里昂博士.jpg',
  '裂谷-泉.jpg',
  '食人资本主义-南希·弗雷泽.jpg',
  '鱼出现的夜晚：乔·R.兰斯代尔短篇小说集-乔·R.兰斯代尔.jpg'
]

const bookCovers: Book[] = filenames.map((fn, idx) => {
  const base = fn.replace(/\.jpg$/i, '')
  const dash = base.lastIndexOf('-')
  const title = dash >= 0 ? base.slice(0, dash).trim() : base
  const author = dash >= 0 ? base.slice(dash + 1).trim() : ''
  return { id: idx + 1, title, author, image: `/INDEXJPG/${fn}` }
})

export default function BookGrid() {
  const { t } = useTranslation('landing')
  const itemsAll = bookCovers
  const Card = ({ book }: { book: Book }) => (
    <div className="book-card rounded-lg shadow-lg transition-transform duration-medium hover:scale-x-[1.08] hover:scale-y-[1.12] hover:shadow-2xl hover:z-10 relative flex flex-col items-center justify-start p-1 md:p-2 cursor-default" style={{ width: 180, willChange: 'transform', background: '#fff' }}>
      <div className="w-full rounded-md overflow-hidden" style={{ aspectRatio: '2 / 3', background: '#f3f4f6' }}>
        <img src={book.image} alt={book.title} className="w-full h-full object-cover" />
      </div>
      <div className="w-full text-center mt-1">
        <div className="text-[10px] md:text-sm mb-0.5" style={{ fontWeight: 700, color: '#111', lineHeight: 1.2 }}>{book.title}</div>
        <div className="text-[8px] md:text-xs" style={{ fontWeight: 500, color: '#555', opacity: 0.9 }}>{book.author}</div>
      </div>
    </div>
  )
  const Track = ({ items, delay }: { items: Book[]; delay: number }) => (
    <div className="marquee-row marquee-mask">
      <motion.div className="marquee-track" initial={{ x: '0%' }} animate={{ x: ['0%', '-50%'] }} transition={{ duration: 90, ease: 'linear', repeat: Infinity, delay }}>
        {items.map((b) => <Card key={`a-${b.id}`} book={b} />)}
        {items.map((b) => <Card key={`b-${b.id}`} book={b} />)}
      </motion.div>
    </div>
  )
  return (
    <div className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div initial={{ y: 60, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8 }} className="text-center mb-16">
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-6" style={{ fontWeight: 700, lineHeight: 1.1 }}>{t('bookGrid.titleLine1')}</h2>
          <h2 className="text-5xl md:text-6xl text-gray-900 mb-8" style={{ fontWeight: 700, lineHeight: 1.1 }}>{t('bookGrid.titleLine2')}</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">{t('bookGrid.description')}</p>
        </motion.div>
        <motion.div initial={{ y: 80, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true, margin: '-100px' }} transition={{ duration: 0.8, delay: 0.2 }}>
          <Track items={itemsAll} delay={0} />
        </motion.div>
      </div>
    </div>
  )
}