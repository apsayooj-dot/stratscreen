// auth.js - registration, login, logout, and route guarding.
// Depends on firebase-config.js having run first (defines `auth`).

function showError(el, message) {
  el.textContent = message;
  el.classList.add("visible");
}

function hideError(el) {
  el.textContent = "";
  el.classList.remove("visible");
}

function friendlyAuthError(error) {
  const map = {
    "auth/email-already-in-use": "That email is already registered. Try logging in instead.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  };
  return map[error.code] || error.message;
}

function initRegisterForm() {
  const form = document.getElementById("register-form");
  if (!form) return;
  const errorEl = document.getElementById("form-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError(errorEl);
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      if (name) {
        await cred.user.updateProfile({ displayName: name });
      }
      window.location.href = "home.html";
    } catch (err) {
      showError(errorEl, friendlyAuthError(err));
      submitBtn.disabled = false;
    }
  });
}

function initLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;
  const errorEl = document.getElementById("form-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError(errorEl);
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await auth.signInWithEmailAndPassword(email, password);
      window.location.href = "home.html";
    } catch (err) {
      showError(errorEl, friendlyAuthError(err));
      submitBtn.disabled = false;
    }
  });
}

function initLogoutButton() {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await auth.signOut();
    window.location.href = "login.html";
  });
}

// Guards dashboard.html: redirect to login if not signed in.
function requireAuth() {
  auth.onAuthStateChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
    } else {
      const nameEl = document.getElementById("user-name");
      if (nameEl) {
        nameEl.textContent = user.displayName || user.email;
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initRegisterForm();
  initLoginForm();
  initLogoutButton();
});
