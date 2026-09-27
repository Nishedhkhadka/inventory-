import jwt from "jsonwebtoken";
import User from "../models/User.js";

function issueToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

const publicUser = (user) => ({
  id: user._id,
  username: user.username,
  role: user.role,
  createdAt: user.createdAt,
});

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }

    const user = await User.findOne({ username: username.trim().toLowerCase() });
    // Same generic message whether the username or password was wrong —
    // never reveal which one, so a login form can't be used to enumerate
    // valid usernames.
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = issueToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET /api/auth/me — lets the frontend confirm the stored token is still
// valid and know the current user's role after a page refresh.
export const me = async (req, res) => {
  res.json(publicUser(req.user));
};

// GET /api/auth/users  (admin only)
export const listUsers = async (req, res) => {
  try {
    const users = await User.find({}).sort({ username: 1 });
    res.json(users.map(publicUser));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST /api/auth/users  (admin only)
// Body: { username, password, role }
export const createUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    if (role && !["admin", "user"].includes(role)) {
      return res.status(400).json({ message: 'Role must be "admin" or "user"' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const existing = await User.findOne({ username: normalizedUsername });
    if (existing) {
      return res.status(409).json({ message: "That username is already taken" });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      username: normalizedUsername,
      passwordHash,
      role: role || "user",
    });

    res.status(201).json(publicUser(user));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// DELETE /api/auth/users/:id  (admin only)
export const deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user.id.toString()) {
      return res.status(400).json({ message: "You can't delete your own account while logged in" });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT /api/auth/users/:id/password  (admin only) — reset another user's
// password, e.g. after they forget it. Admins can't be locked out since
// this never requires the OLD password.
export const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }
    const passwordHash = await User.hashPassword(password);
    const user = await User.findByIdAndUpdate(req.params.id, { passwordHash }, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
