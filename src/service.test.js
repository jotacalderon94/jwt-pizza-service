const request = require('supertest');
const app = require('./service');
const { DB } = require('./database/database');

beforeAll(async () => {
  await DB.initialized;
});

test('the service exposes a welcome response', async () => {
  const response = await request(app).get('/').set('Origin', 'https://client.test');

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ message: 'welcome to JWT Pizza', version: expect.any(String) });
  expect(response.headers['access-control-allow-origin']).toBe('https://client.test');
});

test('the docs endpoint describes the API', async () => {
  const response = await request(app).get('/api/docs');

  expect(response.status).toBe(200);
  expect(response.body.version).toEqual(expect.any(String));
  expect(response.body.endpoints.length).toBeGreaterThan(10);
  expect(response.body.config).toEqual(expect.objectContaining({ factory: expect.any(String), db: expect.any(String) }));
});

test('unknown endpoints return a JSON 404', async () => {
  const response = await request(app).get('/not-a-real-endpoint');

  expect(response.status).toBe(404);
  expect(response.body).toEqual({ message: 'unknown endpoint' });
});
