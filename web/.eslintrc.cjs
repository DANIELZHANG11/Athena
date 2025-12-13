/**
 * ESLint 配置
 * - TypeScript/React 推荐规则
 * - 关闭部分规则以适配项目风格
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended', 
    'plugin:react/recommended', 
    'plugin:react-hooks/recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  settings: { react: { version: 'detect' } },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/no-unescaped-entities': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'no-empty': 'warn'
  }
}
