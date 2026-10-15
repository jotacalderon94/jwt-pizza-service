const express = require('express');
const { asyncHandler } = require('../endpointHelper.js');
const { DB, Role } = require('../database/database.js');
const { authRouter, setAuth } = require('./authRouter.js');

const userRouter = express.Router();

userRouter.docs = [
  {
    method: 'GET',
    path: '/api/user/me',
    requiresAuth: true,
    description: 'Get authenticated user',
    example: `curl -X GET localhost:3000/api/user/me -H 'Authorization: Bearer tttttt'`,
    response: {
      id: 1,
      name: '常用名字',
      email: 'a@jwt.com',
      roles: [{ role: 'admin' }],
    },
  },
  {
    method: 'PUT',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Update user',
    example: `curl -X PUT localhost:3000/api/user/1 -d '{"name":"Updated Name"}' -H 'Content-Type: application/json' -H 'Authorization: Bearer tttttt'`,
    response: {
      user: {
        id: 1,
        name: 'Updated Name',
        email: 'a@jwt.com',
        roles: [{ role: 'admin' }],
      },
      token: 'tttttt',
    },
  },
  {
    method: 'GET',
    path: '/api/user',
    requiresAuth: true,
    description: 'List users (admin only). Page numbering starts at 1.',
    example: `curl 'localhost:3000/api/user?page=1&limit=10&name=*' -H 'Authorization: Bearer tttttt'`,
    response: {
      users: [
        {
          id: 1,
          name: '常用名字',
          email: 'a@jwt.com',
          roles: [{ role: 'admin' }],
        },
      ],
      more: false,
    },
  },
  {
    method: 'DELETE',
    path: '/api/user/:userId',
    requiresAuth: true,
    description: 'Delete user (admin only)',
    example: `curl -X DELETE localhost:3000/api/user/2 -H 'Authorization: Bearer tttttt'`,
    response: { message: 'user deleted' },
  },
];

function validUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0;
}

function validText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// getUser
userRouter.get(
  '/me',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// updateUser
userRouter.put(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!validUserId(req.params.userId)) {
      return res.status(400).json({ message: 'invalid user ID' });
    }

    const userId = Number(req.params.userId);
    const user = req.user;

    if (user.id !== userId && !user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const { name, email, password } = req.body ?? {};

    if (
      (name !== undefined && !validText(name)) ||
      (email !== undefined &&
        (!validText(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
      (password !== undefined && !validText(password))
    ) {
      return res.status(400).json({ message: 'invalid user data' });
    }

    if (
      name === undefined &&
      email === undefined &&
      password === undefined
    ) {
      return res.status(400).json({ message: 'no fields to update' });
    }

    const updatedUser = await DB.updateUser(
      userId,
      name,
      email,
      password
    );

    const token = await setAuth(updatedUser);
    res.json({ user: updatedUser, token });
  })
);
// deleteUser
userRouter.delete(
  '/:userId',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    if (!validUserId(req.params.userId)) {
      return res.status(400).json({ message: 'invalid user ID' });
    }

    const userId = Number(req.params.userId);

    if (userId === req.user.id) {
      return res.status(403).json({
        message: 'cannot delete your own account',
      });
    }

    await DB.deleteUser(userId);
    res.json({ message: 'user deleted' });
  })
);

// listUsers
userRouter.get(
  '/',
  authRouter.authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user.isRole(Role.Admin)) {
      return res.status(403).json({ message: 'unauthorized' });
    }

    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const name = req.query.name ?? '*';

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      typeof name !== 'string'
    ) {
      return res.status(400).json({
        message: 'invalid pagination or filter parameters',
      });
    }

    const result = await DB.getUsers(page, limit, name);
    res.json(result);
  })
);

module.exports = userRouter;