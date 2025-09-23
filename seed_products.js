const { initFirebaseAdmin } = require('./firebaseAdmin');
const admin = initFirebaseAdmin();
const db = admin.firestore();

async function seed() {
  const products = [
    {
      name: 'Premium Basmati Rice 5kg',
      price: 799,
      category: 'Groceries',
      stock: 120,
      description: 'Long-grain premium basmati rice with rich aroma.',
      image: 'https://via.placeholder.com/300x300?text=Basmati+Rice',
      brand: 'Krishnamart Select',
      createdAt: Date.now()
    },
    {
      name: 'Organic Turmeric Powder 200g',
      price: 149,
      category: 'Spices',
      stock: 300,
      description: '100% organic turmeric, high in curcumin.',
      image: 'https://via.placeholder.com/300x300?text=Turmeric',
      brand: 'Krishnamart Organics',
      createdAt: Date.now()
    },
    {
      name: 'Cold Pressed Groundnut Oil 1L',
      price: 349,
      category: 'Oils',
      stock: 80,
      description: 'Pure cold pressed groundnut oil for healthy cooking.',
      image: 'https://via.placeholder.com/300x300?text=Groundnut+Oil',
      brand: 'Healthy Choice',
      createdAt: Date.now()
    },
    {
      name: 'Whole Wheat Atta 10kg',
      price: 549,
      category: 'Groceries',
      stock: 150,
      description: 'Stone-ground whole wheat flour for soft rotis.',
      image: 'https://via.placeholder.com/300x300?text=Wheat+Atta',
      brand: 'Krishnamart Select',
      createdAt: Date.now()
    }
  ];

  const batch = db.batch();
  const col = db.collection('products');
  products.forEach(p => {
    const ref = col.doc();
    batch.set(ref, p);
  });

  await batch.commit();
  console.log(`Seeded ${products.length} products.`);
}

seed().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});




