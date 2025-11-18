import { motion } from 'motion/react';
import { ChevronRight } from 'lucide-react';

const faqs = [
  {
    question: 'What is Athena Reader?',
  },
  {
    question: 'How does Family Sharing work with Athena Reader?',
  },
  {
    question: 'Can I get Athena Reader on my device?',
  },
  {
    question: 'Can I get audiobooks on Athena Reader?',
  },
  {
    question: 'Can I share books from Athena Reader with my friends?',
  },
  {
    question: 'If I buy a book on one device, can I read it on another?',
  },
];

export function FAQ() {
  return (
    <div className="py-32 bg-white">
      <div className="max-w-3xl mx-auto px-6">
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8 }}
          className="text-center mb-16"
        >
          <h2 
            className="text-5xl md:text-6xl text-gray-900 mb-6"
            style={{ fontWeight: 700, lineHeight: 1.1 }}
          >
            Questions? Answers.
          </h2>
        </motion.div>

        <motion.div
          initial={{ y: 80, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="space-y-1"
        >
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ y: 40, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ 
                duration: 0.6,
                delay: 0.3 + (index * 0.05)
              }}
              className="bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between p-6">
                <p 
                  className="text-lg text-gray-900"
                  style={{ fontWeight: 600 }}
                >
                  {faq.question}
                </p>
                <ChevronRight className="w-6 h-6 text-gray-400 group-hover:text-gray-600 transition-colors flex-shrink-0 ml-4" />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
