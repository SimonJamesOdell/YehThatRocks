const mysql = require('mysql2/promise');
async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute('SELECT slug, deck, body FROM magazine_articles ORDER BY created_at DESC LIMIT 1');
  const row = rows[0];
  console.log('SLUG:', row.slug);
  console.log('DECK:', row.deck);
  console.log();
  JSON.parse(row.body).forEach(b => console.log(b.type.toUpperCase().padEnd(4), b.text || ''));
  await conn.end();
}
main().catch(console.error);
