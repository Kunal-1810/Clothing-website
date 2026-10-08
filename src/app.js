require("dotenv").config();


const express = require("express");
const path = require("path");
const hbs = require("hbs");
const session = require("express-session");
const { MongoStore } = require("connect-mongo"); // connect-mongo v6+. On v5 or older: const MongoStore = require("connect-mongo");
const bcrypt = require("bcryptjs");

const connectDB = require("./db/conn");
const User = require("./models/user");
const Product = require("./models/product");

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
const debugErrors = process.env.DEBUG_ERRORS === "true";

const static_path = path.join(__dirname, "../public");
const template_path = path.join(__dirname, "./templates/views");
const partials_path = path.join(__dirname, "./templates/partials");

// Vercel sits behind a proxy; needed so secure cookies work in production
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(static_path));
app.set("view engine", "hbs");
app.set("views", template_path);
hbs.registerPartials(partials_path);


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

const requireLogin = (req, res, next) =>
  req.session.user ? next() : res.redirect("/login");
const redirectIfLoggedIn = (req, res, next) =>
  req.session.user ? res.redirect("/") : next();

// ---------- Pages ----------
app.get("/", (req, res) => res.render("home"));
app.get("/about", (req, res) => res.render("about"));
app.get("/login", redirectIfLoggedIn, (req, res) => res.render("login"));
app.get("/register", redirectIfLoggedIn, (req, res) => res.render("register"));

// Category pages (men.html, women.html, kids.html live in src/templates/views)
app.get("/men",   (req, res) => res.sendFile(path.join(template_path, "men.html")));
app.get("/women", (req, res) => res.sendFile(path.join(template_path, "women.html")));
app.get("/kids",  (req, res) => res.sendFile(path.join(template_path, "kids.html")));

// ---------- Products ----------
// Shop now + Search
app.get("/products", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    let filter = {};
    if (q) {
      // escape regex special characters so the search can't break
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      filter = { $or: [{ name: rx }, { type: rx }, { category: rx }] };
    }
    const products = await Product.find(filter).lean();
    res.render("products", { products, query: q });
  } catch (err) {
    console.error("GET /products failed:", err);
    res
      .status(500)
      .send(debugErrors ? "Error: " + err.message : "Something went wrong");
  }
});

// View button
app.get("/products/:id", async (req, res) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(req.params.id)) {
      return res.status(404).send("Product not found");
    }
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).send("Product not found");
    res.render("product-details", { product });
  } catch (err) {
    console.error("GET /products/:id failed:", err);
    res
      .status(500)
      .send(debugErrors ? "Error: " + err.message : "Something went wrong");
  }
});

// ---------- Profile ----------
app.get("/profile", requireLogin, async (req, res) => {
  try {
    const dbUser = await User.findById(req.session.user.id)
      .select("-password")
      .lean();

    if (!dbUser) {
      return req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
      });
    }

    res.render("profile", { profile: dbUser });
  } catch (err) {
    console.error(err);
    res.redirect("/");
  }
});

// ---------- Auth ----------
app.post("/register", redirectIfLoggedIn, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.render("register", { error: "Email is already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
    });

    req.session.user = { id: user._id, name: user.name, email: user.email };
    req.session.save(() => res.redirect("/"));
  } catch (err) {
    console.error(err);
    res.render("register", { error: "Something went wrong. Try again." });
  }
});

app.post("/login", redirectIfLoggedIn, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() });
    const ok = user && (await bcrypt.compare(password, user.password));

    if (!ok) {
      return res.render("login", { error: "Invalid email or password" });
    }

    req.session.regenerate((err) => {
      if (err) {
        return res.render("login", { error: "Login failed. Try again." });
      }
      req.session.user = { id: user._id, name: user.name, email: user.email };
      req.session.save(() => res.redirect("/"));
    });
  } catch (err) {
    console.error(err);
    res.render("login", { error: "Something went wrong. Try again." });
  }
});

app.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

// ---------- 404 (keep this last) ----------
app.use((req, res) => res.status(404).send("Page not found"));

// Run a normal server locally; on Vercel the app is exported instead
if (require.main === module) {
  app.listen(port, () => console.log(`Server is running on port ${port}`));
}

module.exports = app;