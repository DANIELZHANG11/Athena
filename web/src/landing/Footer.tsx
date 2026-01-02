import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation('landing')

  return (
    <footer className="bg-secondary-background text-secondary-label py-12 border-t border-separator">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-8">
          <p className="text-sm mb-4">{t('footer.disclaimer')}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }} className="border-t border-separator pt-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-8 text-sm">
            <div>
              <h4 className="text-label mb-3 font-semibold">{t('footer.shopAndLearn.title')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.shopAndLearn.store')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.shopAndLearn.mac')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.shopAndLearn.iPad')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.shopAndLearn.iPhone')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-label mb-3 font-semibold">{t('footer.services.title')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.services.reader')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.services.music')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.services.tv')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.services.arcade')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-label mb-3 font-semibold">{t('footer.account.title')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.account.manageId')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.account.account')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.account.icloud')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-label mb-3 font-semibold">{t('footer.store.title')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.store.findStore')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.store.geniusBar')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.store.shoppingHelp')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-label mb-3 font-semibold">{t('footer.about.title')}</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.about.newsroom')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.about.leadership')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.about.careers')}</a></li>
                <li><a href="#" className="hover:text-label transition-colors">{t('footer.about.contact')}</a></li>
              </ul>
            </div>
          </div>
          <div className="text-sm text-tertiary-label pt-6 border-t border-separator">
            <p className="mb-4" dangerouslySetInnerHTML={{
              __html: t('footer.moreWays', {
                findStore: `<a href="#" class="text-[var(--color-system-blue)] hover:underline">${t('footer.store.findStore')}</a>`,
                otherRetailer: `<a href="#" class="text-[var(--color-system-blue)] hover:underline">${t('footer.otherRetailer')}</a>`
              })
            }} />
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <p>{t('footer.copyright')}</p>
              <div className="flex gap-4">
                <a href="#" className="hover:text-label transition-colors">{t('footer.privacyPolicy')}</a>
                <span>|</span>
                <a href="#" className="hover:text-label transition-colors">{t('footer.termsOfUse')}</a>
                <span>|</span>
                <a href="#" className="hover:text-label transition-colors">{t('footer.siteMap')}</a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </footer>
  )
}