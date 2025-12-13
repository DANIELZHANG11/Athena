import { motion } from 'motion/react';

export function Footer() {
  return (
    <footer className="bg-gray-50 text-gray-600 py-12 border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-8"
        >
          <p className="text-sm mb-4">
            * Family Sharing requires a personal Apple ID signed in to iCloud and iTunes. 
            Music, movies, TV shows, and books can be downloaded on up to 10 devices per 
            account, five of which can be computers.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="border-t border-gray-200 pt-8"
        >
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-8 text-sm">
            {/* Shop and Learn */}
            <div>
              <h4 className="text-gray-900 mb-3" style={{ fontWeight: 600 }}>Shop and Learn</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Store</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Mac</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">iPad</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">iPhone</a></li>
              </ul>
            </div>

            {/* Services */}
            <div>
              <h4 className="text-gray-900 mb-3" style={{ fontWeight: 600 }}>Services</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Athena Reader</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Athena Music</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Athena TV+</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Athena Arcade</a></li>
              </ul>
            </div>

            {/* Account */}
            <div>
              <h4 className="text-gray-900 mb-3" style={{ fontWeight: 600 }}>Account</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Manage Your ID</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Account</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">iCloud.com</a></li>
              </ul>
            </div>

            {/* Athena Store */}
            <div>
              <h4 className="text-gray-900 mb-3" style={{ fontWeight: 600 }}>Athena Store</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Find a Store</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Genius Bar</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Shopping Help</a></li>
              </ul>
            </div>

            {/* About Athena */}
            <div>
              <h4 className="text-gray-900 mb-3" style={{ fontWeight: 600 }}>About Athena</h4>
              <ul className="space-y-2">
                <li><a href="#" className="hover:text-gray-900 transition-colors">Newsroom</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Leadership</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Careers</a></li>
                <li><a href="#" className="hover:text-gray-900 transition-colors">Contact Us</a></li>
              </ul>
            </div>
          </div>

          <div className="text-sm text-gray-500 pt-6 border-t border-gray-200">
            <p className="mb-4">
              More ways to shop: <a href="#" className="text-blue-600 hover:underline">Find a Store</a> or{' '}
              <a href="#" className="text-blue-600 hover:underline">other retailer</a> near you. 
              Or call 1-800-MY-ATHENA.
            </p>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <p>Copyright © 2024 Athena Inc. All rights reserved.</p>
              <div className="flex gap-4">
                <a href="#" className="hover:text-gray-900 transition-colors">Privacy Policy</a>
                <span>|</span>
                <a href="#" className="hover:text-gray-900 transition-colors">Terms of Use</a>
                <span>|</span>
                <a href="#" className="hover:text-gray-900 transition-colors">Site Map</a>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </footer>
  );
}
