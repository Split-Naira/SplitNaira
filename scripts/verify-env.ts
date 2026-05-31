const required = [
  'VITE_API_URL',
  'VITE_NETWORK',
];

const missing = required.filter(
  (key) => !process.env[key],
);

if (missing.length) {
  console.error(
    `Missing environment variables: ${missing.join(', ')}`,
  );

  process.exit(1);
}