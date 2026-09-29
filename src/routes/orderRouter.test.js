const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

const suffix = () => Math.random().toString(36).slice(2, 12);
const admin = { name: `order admin ${suffix()}`, email: `${suffix()}@test.com`, password: 'admin-password' };
const diner = { name: `order diner ${suffix()}`, email: `${suffix()}@test.com`, password: 'diner-password' };
let adminToken;
let dinerToken;
let franchise;
let store;
let menuItem;

beforeAll(async () => {
  await DB.addUser({ ...admin, roles: [{ role: Role.Admin }] });
  await DB.addUser({ ...diner, roles: [{ role: Role.Diner }] });
  adminToken = (await request(app).put('/api/auth').send(admin)).body.token;
  dinerToken = (await request(app).put('/api/auth').send(diner)).body.token;
  menuItem = await DB.addMenuItem({ title: `Test pizza ${suffix()}`, description: 'integration test pizza', image: 'test.png', price: 0.12345678 });
  franchise = await DB.createFranchise({ name: `Order franchise ${suffix()}`, admins: [{ email: admin.email }] });
  store = await DB.createStore(franchise.id, { name: `Order store ${suffix()}` });
});

test('anyone can view the menu', async () => {
  const response = await request(app).get('/api/order/menu');

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: menuItem.id, title: menuItem.title })]));
});

test('only admins can add menu items', async () => {
  const item = { title: `Admin pizza ${suffix()}`, description: 'admin-only item', image: 'admin.png', price: 0.2 };
  const unauthenticated = await request(app).put('/api/order/menu').send(item);
  const dinerResponse = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${dinerToken}`).send(item);
  const adminResponse = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminToken}`).send(item);

  expect(unauthenticated.status).toBe(401);
  expect(dinerResponse.status).toBe(403);
  expect(adminResponse.status).toBe(200);
  expect(adminResponse.body).toEqual(expect.arrayContaining([expect.objectContaining({ title: item.title })]));
});

test('a diner can view their empty order list', async () => {
  const unauthenticated = await request(app).get('/api/order');
  const response = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerToken}`);

  expect(unauthenticated.status).toBe(401);
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ orders: [], page: 1 });
});

test('creating an order persists it and handles a successful factory response', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ reportUrl: 'https://factory.test/report', jwt: 'factory-jwt' }) });
  try {
    const response = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send({ franchiseId: franchise.id, storeId: store.id, items: [{ menuId: menuItem.id, description: 'test order item', price: 0.12345678 }] });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ order: { franchiseId: franchise.id, storeId: store.id }, followLinkToEndChaos: 'https://factory.test/report', jwt: 'factory-jwt' });
  } finally {
    global.fetch = oldFetch;
  }
});

test('order creation reports a factory failure', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({ reportUrl: 'https://factory.test/failed' }) });
  try {
    const response = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send({ franchiseId: franchise.id, storeId: store.id, items: [{ menuId: menuItem.id, description: 'failed factory item', price: 0.2 }] });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to fulfill order at factory', followLinkToEndChaos: 'https://factory.test/failed' });
  } finally {
    global.fetch = oldFetch;
  }
});

test('the order list includes created order items', async () => {
  const response = await request(app).get('/api/order?page=1').set('Authorization', `Bearer ${dinerToken}`);

  expect(response.status).toBe(200);
  expect(response.body.orders.length).toBeGreaterThanOrEqual(2);
  expect(response.body.orders[0].items).toEqual(expect.arrayContaining([expect.objectContaining({ description: expect.any(String) })]));
});
