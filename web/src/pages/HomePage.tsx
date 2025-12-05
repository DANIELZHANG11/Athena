/**
 * 公共首页（营销着陆页）
 *
 * 说明：
 * - 组合 Hero、功能卡片、设备支持、精选书籍等区块
 * - 文案通过 `landing` 命名空间的 i18n 文本提供
 * - CTA 按钮跳转到应用区 `/app/read-now`
 */

import { Button } from '../components/ui/button'
import Hero from '../landing/Hero'
import FeatureCards from '../landing/FeatureCards'
import BookGrid from '../landing/BookGrid'
import DeviceCompatibility from '../landing/DeviceCompatibility'
import FeatureHighlight from '../landing/FeatureHighlight'
import CTASection from '../landing/CTASection'
import Footer from '../landing/Footer'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function HomePage() {
  const { t } = useTranslation('landing')
  return (
    <div className="min-h-screen bg-white">
      <Hero />
      <FeatureCards />
      <BookGrid />
      <DeviceCompatibility />
      <FeatureHighlight
        title={t('featureHighlight.title')}
        description={t('featureHighlight.description')}
        imageSrc="/INDEXJPG/知识的繁荣与危机-戴维·温伯格.jpg"
        imageAlt="Featured Book"
      />
      <CTASection />
      <div className="py-12 bg-gray-50 text-center">
        <Link to="/app/read-now">
          <Button size="lg" className="rounded-full px-8 text-lg h-12">
            {t('browse')}
          </Button>
        </Link>
      </div>
      <Footer />
    </div>
  )
}
