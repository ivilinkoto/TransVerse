import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'public/vendor/**', 'drizzle/**', 'data/raw/**', 'playwright-report/**', 'test-results/**'] },
];

export default config;
