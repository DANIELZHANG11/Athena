import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'
import Hero from '../landing/Hero'
import FeatureCards from '../landing/FeatureCards'
import BookGrid from '../landing/BookGrid'
import DeviceCompatibility from '../landing/DeviceCompatibility'
import FeatureHighlight from '../landing/FeatureHighlight'
import CTASection from '../landing/CTASection'
import Footer from '../landing/Footer'

export default function HomePage() {
  const nav = useNavigate()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Hero />
      <FeatureCards />
      <BookGrid />
      <DeviceCompatibility />
      <FeatureHighlight title="Built for readers" description="Organize your library, track your progress, and enjoy seamless reading and listening across devices." imageSrc="https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=1200&h=800&fit=crop" layout="horizontal" />
      <FeatureHighlight title="Curation you'll love" description="Discover bestsellers, classics, and hidden gems curated just for you." layout="vertical" />
      <CTASection />
      <section style={{ background: '#f7f7f9', color: '#555', padding: '24px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', display: 'flex', justifyContent: 'center' }}>
          <Button variant="primary" onClick={() => nav('/library')}>开始浏览</Button>
        </div>
      </section>
      <Footer />
    </div>
  )
}
