module.exports = {
  jwtSecret: process.env.JWT_SECRET,

  db: {
    connection: {
      host: process.env.DB_HOSTNAME,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: 'pizza',
      connectTimeout: 60000,
    },
    listPerPage: 10,
  },

  factory: {
    url: 'https://pizza-factory.cs329.click',
    apiKey: process.env.FACTORY_API_KEY,
  },
};