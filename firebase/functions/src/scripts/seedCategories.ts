import 'dotenv/config';
import { getDb } from './_firestoreClient';

async function main() {
  const db = getDb();
  const data = [
    {
      id: 'mobile-battery',
      name: 'モバイルバッテリー',
      path: ['electronics', 'mobile-battery'],
      order: 1,
    },
    {
      id: 'fast-charging',
      name: '急速充電',
      path: ['electronics', 'mobile-battery', 'fast-charging'],
      order: 2,
    },
  ];
  for (const c of data) {
    await db.collection('categories').doc(c.id).set(c, { merge: true });
  }
  console.log('✅ categories seed done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
