async function getJson(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Request failed");
  return await res.json();
}

function queryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueValues(list) {
  return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeBookingStatus(statusValue) {
  const normalized = String(statusValue || "").trim().toLowerCase();
  if (normalized === "complete") return "completed";
  return normalized;
}

function setSelectOptions(select, values, label) {
  if (!select) return;
  select.innerHTML =
    `<option value="">${label}</option>` +
    values.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
}

function getCardImage(worker) {
  if (Array.isArray(worker.portfolio) && worker.portfolio.length) return worker.portfolio[0];
  return "assets/img/homepage-img.jpg";
}

function getWorkerAvailabilityStatus(worker) {
  const availability = Array.isArray(worker?.availability) ? worker.availability : [];
  const lowered = availability.map((item) => String(item || "").trim().toLowerCase());
  return lowered.includes("unavailable") ? "unavailable" : "available";
}

function getWorkerAvailabilityText(worker) {
  const availability = Array.isArray(worker?.availability) ? worker.availability : [];
  return availability
    .filter((item) => {
      const value = String(item || "").trim().toLowerCase();
      return value !== "available" && value !== "unavailable";
    })
    .join(", ");
}

async function initAuthNav() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  const authButton = Array.from(topbar.querySelectorAll(".ghost-btn")).find((btn) => {
    if (!(btn instanceof HTMLAnchorElement)) return false;
    const href = btn.getAttribute("href") || "";
    const label = (btn.textContent || "").trim().toLowerCase();
    return href.includes("login.html") || label === "sign in";
  });
  if (!(authButton instanceof HTMLAnchorElement)) return;

  if (!authButton.dataset.loggedoutLabel) authButton.dataset.loggedoutLabel = authButton.textContent || "Sign In";
  if (!authButton.dataset.loggedoutHref) authButton.dataset.loggedoutHref = authButton.getAttribute("href") || "login.html";

  let logoutButton = topbar.querySelector("[data-auth-logout]");
  if (logoutButton && !(logoutButton instanceof HTMLAnchorElement)) logoutButton = null;

  try {
    const session = await getJson("api/auth/session");
    if (session.logged_in) {
      authButton.href = "profile.html";
      authButton.classList.add("profile-nav-btn");
      authButton.innerHTML = '<i class="fa-solid fa-circle-user"></i>';
      authButton.setAttribute("aria-label", "Profile");
      authButton.title = "Profile";

      if (!logoutButton) {
        logoutButton = document.createElement("a");
        logoutButton.className = "ghost-btn";
        logoutButton.href = "api/auth/logout";
        logoutButton.textContent = "Logout";
        logoutButton.setAttribute("data-auth-logout", "true");
        logoutButton.setAttribute("aria-label", "Logout");
        authButton.insertAdjacentElement("afterend", logoutButton);
      }
    } else {
      authButton.href = authButton.dataset.loggedoutHref;
      authButton.classList.remove("profile-nav-btn");
      authButton.textContent = authButton.dataset.loggedoutLabel;
      authButton.setAttribute("aria-label", authButton.dataset.loggedoutLabel);
      authButton.removeAttribute("title");
      logoutButton?.remove();
    }
  } catch (_error) {
    // Keep logged-out nav if session check fails.
    authButton.href = authButton.dataset.loggedoutHref;
    authButton.classList.remove("profile-nav-btn");
    authButton.textContent = authButton.dataset.loggedoutLabel;
    authButton.setAttribute("aria-label", authButton.dataset.loggedoutLabel);
    authButton.removeAttribute("title");
    logoutButton?.remove();
  }
}

function renderWorkers(list, container) {
  if (!container) return;
  if (!list.length) {
    container.innerHTML = '<p class="muted">No workers found for these filters.</p>';
    return;
  }

  container.innerHTML = list
    .map(
      (w, index) => `
      <article class="worker-card">
        <div class="worker-media">
          <span class="badge badge-left">${index % 2 === 0 ? "Available Today" : "Available Tomorrow"}</span>
          ${w.verified ? '<span class="badge badge-right">Verified</span>' : ""}
          <img src="${escapeHtml(getCardImage(w))}" alt="${escapeHtml(w.name)}">
        </div>
        <div class="worker-card-body">
          <h3>${escapeHtml(w.name)}</h3>
          <div class="worker-skill">${escapeHtml(w.skill)}</div>
          <div class="worker-meta">* ${w.rating} | ${escapeHtml(w.location)} | KSh ${w.price_per_hour}/hr</div>
          <div class="card-actions">
            <a class="btn alt" href="profile.html?id=${w.id}">View Profile</a>
            <a class="btn" href="booking.html?worker=${w.id}">Book</a>
          </div>
        </div>
      </article>
    `,
    )
    .join("");
}

function applyHomeFilters(workers) {
  const keyword = (document.getElementById("filterKeyword")?.value || "").trim().toLowerCase();
  const service = (document.getElementById("filterService")?.value || "").trim().toLowerCase();
  const location = (document.getElementById("filterLocation")?.value || "").trim().toLowerCase();
  const sort = document.getElementById("filterSort")?.value || "rating";

  let filtered = workers.filter((w) => {
    const textPool = `${w.name} ${w.skill} ${w.bio}`.toLowerCase();
    const keywordMatch = !keyword || textPool.includes(keyword);
    const serviceMatch = !service || w.skill.toLowerCase() === service;
    const locationMatch = !location || w.location.toLowerCase() === location;
    return keywordMatch && serviceMatch && locationMatch;
  });

  if (sort === "rating") filtered.sort((a, b) => b.rating - a.rating);
  if (sort === "price_asc") filtered.sort((a, b) => a.price_per_hour - b.price_per_hour);

  renderWorkers(filtered, document.getElementById("results"));
  const verifiedCount = filtered.filter((w) => w.verified).length;
  const countBox = document.getElementById("workersCount");
  if (countBox) countBox.textContent = `${verifiedCount} verified workers available`;
}

function initContactForm() {
  const form = document.getElementById("contactForm");
  const message = document.getElementById("contactFormMessage");
  if (!form || !message) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = String(document.getElementById("contact_name")?.value || "").trim();
    const email = String(document.getElementById("contact_email")?.value || "").trim();
    const subject = String(document.getElementById("contact_subject")?.value || "").trim();
    const body = String(document.getElementById("contact_message")?.value || "").trim();

    if (!name || !email || !subject || !body) {
      message.textContent = "Please complete all fields before sending your message.";
      return;
    }

    const subjectLabel =
      document.getElementById("contact_subject") instanceof HTMLSelectElement
        ? document.getElementById("contact_subject").selectedOptions[0]?.textContent || "selected"
        : "selected";

    message.textContent = `Thanks ${name}. Your ${subjectLabel.toLowerCase()} message has been received. We will get back to you soon.`;
    form.reset();
  });
}

async function initHome() {
  const results = document.getElementById("results");
  if (!results) return;

  const workers = await getJson("api/workers");
  const skills = uniqueValues(workers.map((w) => w.skill));
  const locations = uniqueValues(workers.map((w) => w.location));

  setSelectOptions(document.getElementById("homeService"), skills, "All Services");
  setSelectOptions(document.getElementById("filterService"), skills, "All Services");
  setSelectOptions(document.getElementById("filterLocation"), locations, "All Locations");

  applyHomeFilters(workers);

  const heroForm = document.getElementById("heroSearchForm");
  const filterKeyword = document.getElementById("filterKeyword");
  const filterService = document.getElementById("filterService");
  const homeKeyword = document.getElementById("homeKeyword");
  const homeService = document.getElementById("homeService");

  if (heroForm && filterKeyword && filterService && homeKeyword && homeService) {
    heroForm.addEventListener("submit", (event) => {
      event.preventDefault();
      filterKeyword.value = homeKeyword.value;
      filterService.value = homeService.value;
      applyHomeFilters(workers);
      document.getElementById("workers")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  ["filterKeyword", "filterService", "filterLocation", "filterSort"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(id === "filterKeyword" ? "input" : "change", () => applyHomeFilters(workers));
  });

  initContactForm();
}

async function initWorkerProfile(workerId) {
  const profileCard = document.getElementById("profileCard");
  if (!profileCard) return;

  let worker;
  try {
    worker = await getJson(`api/workers/${workerId}`);
  } catch (_error) {
    profileCard.innerHTML = "<p class='muted'>Worker not found.</p>";
    return;
  }

  profileCard.innerHTML = `
    <section class="profile-top">
      <div class="profile-head">
        <img class="avatar" src="${escapeHtml(getCardImage(worker))}" alt="${escapeHtml(worker.name)}">
        <div>
          <h1 class="profile-name">${escapeHtml(worker.name)}</h1>
          <div class="profile-role">${escapeHtml(worker.skill)}</div>
          <div class="profile-sub">${escapeHtml(worker.location)}</div>
        </div>
        <div class="status-pill">* ${worker.verified ? "Available" : "Pending Verification"}</div>
      </div>
      <div class="stats">
        <div class="stat"><strong>* ${worker.rating}</strong><span>${(worker.reviews || []).length} reviews</span></div>
        <div class="stat"><strong>KSh ${worker.price_per_hour}</strong><span>Per hour</span></div>
        <div class="stat"><strong>${escapeHtml(worker.location)}</strong><span>Location</span></div>
        <div class="stat"><strong>${worker.verified ? "Verified" : "Not verified"}</strong><span>Status</span></div>
      </div>
      <div class="profile-line">${escapeHtml(worker.bio || "")}</div>
    </section>

    <section class="user-profile-wrap" style="margin-top:0;border-top:none;border-radius:0 0 16px 16px">
      <div class="worker-bookings-head" style="margin-bottom:14px">
        <h2>Client Reviews</h2>
        <span class="muted">${(worker.reviews || []).length} total</span>
      </div>
      ${worker.reviews && worker.reviews.length
        ? worker.reviews.map((r) => {
            const stars = Number(r.rating || 0);
            return `
              <article class="worker-booking-card">
                <div class="worker-booking-head">
                  <h3>${escapeHtml(r.client_name || "Client")}</h3>
                  <span class="booking-status booking-status-approved">
                    ${"★".repeat(stars)}${"☆".repeat(5 - stars)}
                  </span>
                </div>
                <p class="worker-booking-desc">${escapeHtml(r.review || "")}</p>
                <div class="worker-booking-meta muted">
                  ${new Date(r.created_at).toLocaleDateString()}
                </div>
              </article>
            `;
          }).join("")
        : '<p class="muted">No reviews yet. Be the first to book and review this worker.</p>'
      }
    </section>
  `;
}

async function initUserProfile() {
  const profileCard = document.getElementById("profileCard");
  if (!profileCard) return;
  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString();
  };

  try {
    const res = await fetch("api/auth/profile", { credentials: "same-origin" });
    if (!res.ok) throw new Error("Failed to load profile");
    const data = await res.json();
    if (!data.logged_in || !data.user) {
      window.location.href = "login.html";
      return;
    }

    const user = data.user;
    if (user.role === "worker") {
      const [worker, bookings] = await Promise.all([
        getJson("api/worker/profile"),
        getJson("api/worker/bookings")
      ]);
      let workerDisputes = [];
      try {
        workerDisputes = await getJson("api/worker/disputes");
      } catch (_error) {
        workerDisputes = [];
      }
      const availabilityStatus = getWorkerAvailabilityStatus(worker);
      const availabilityValue = getWorkerAvailabilityText(worker);
      const portfolioValue = Array.isArray(worker.portfolio) ? worker.portfolio.join(", ") : "";
      const availabilityLabel = availabilityStatus === "available" ? "Available" : "Unavailable";
      const availabilityAction = availabilityStatus === "available" ? "Set Unavailable" : "Set Available";
      const pendingCount = bookings.filter((b) => String(b.status || "").toLowerCase() === "pending").length;
      const workerVerificationState = worker.verified
        ? {
            text: "Verified",
            detail: "Your worker profile is verified and visible for bookings.",
            className: "booking-status-approved"
          }
        : worker.rejection_reason
          ? {
              text: "Rejected",
              detail: `Reason: ${worker.rejection_reason}`,
              className: "booking-status-declined"
            }
          : {
              text: "Pending Verification",
              detail: "Your worker profile is awaiting admin verification.",
              className: "booking-status-pending"
            };
      const bookingsMarkup = bookings.length
        ? bookings
            .map(
              (booking) => {
                const status = normalizeBookingStatus(booking.status);
                const statusClass = ["pending", "approved", "declined", "completed"].includes(status) ? status : "pending";
                const workerActionsMarkup =
                  status === "pending"
                    ? `
                      <button class="btn" type="button" data-booking-status="accept" data-booking-id="${booking.id}">Accept</button>
                      <button class="btn alt" type="button" data-booking-status="decline" data-booking-id="${booking.id}">Decline</button>
                    `
                    : status === "approved"
                      ? `<button class="btn btn-complete" type="button" data-booking-action="complete" data-booking-id="${booking.id}">Mark as Completed</button>`
                      : status === "completed"
                        ? '<span class="booking-status booking-status-completed">Completed &#10003;</span>'
                        : '<span class="muted">No actions available</span>';

                return `
                  <article class="worker-booking-card">
                    <div class="worker-booking-head">
                      <h3>${escapeHtml(booking.client_name)}</h3>
                      <span class="booking-status booking-status-${escapeHtml(statusClass)}">${escapeHtml(status)}</span>
                    </div>
                    <div class="worker-booking-meta" style="display:grid;gap:6px;margin:10px 0">
                      <div><span class="user-field-label">Phone: </span>${escapeHtml(booking.client_phone || "")}</div>
                      ${booking.client_email ? `<div><span class="user-field-label">Email: </span>${escapeHtml(booking.client_email)}</div>` : ""}
                      ${booking.service_address ? `<div><span class="user-field-label">Address: </span>${escapeHtml(booking.service_address)}</div>` : ""}
                      <div><span class="user-field-label">Date: </span>${escapeHtml(String(booking.date || ""))}</div>
                      <div><span class="user-field-label">Time: </span>${escapeHtml(String(booking.time || ""))}</div>
                      <div><span class="user-field-label">Booking ID: </span>#${booking.id}</div>
                      <div><span class="user-field-label">Received: </span>${new Date(booking.created_at).toLocaleDateString()}</div>
                    </div>
                    <div class="user-field-label" style="margin-bottom:6px">Service needed:</div>
                    <p class="worker-booking-desc">${escapeHtml(booking.description || "")}</p>
                    <div class="worker-booking-actions">
                      ${workerActionsMarkup}
                    </div>
                  </article>
                `;
              }
            )
            .join("")
        : '<p class="muted">No bookings received yet.</p>';
      const workerDisputesMarkup = Array.isArray(workerDisputes) && workerDisputes.length
        ? workerDisputes
            .map((dispute) => {
              const status = String(dispute.status || "open").toLowerCase();
              const statusClass = status === "open" ? "pending" : status === "reviewing" ? "approved" : "completed";
              return `
                <article class="worker-booking-card">
                  <div class="worker-booking-head">
                    <h3>${escapeHtml(dispute.client_name || "Client")}</h3>
                    <span class="booking-status booking-status-${statusClass}">${escapeHtml(status)}</span>
                  </div>
                  <div class="worker-booking-meta">Booking #${escapeHtml(dispute.booking_id || "-")} | ${escapeHtml(formatDate(dispute.created_at))}</div>
                  <p class="worker-booking-desc">${escapeHtml(dispute.description || "")}</p>
                </article>
              `;
            })
            .join("")
        : '<p class="muted">No disputes against your account.</p>';

      profileCard.innerHTML = `
        <section class="user-profile-wrap">
          <div class="user-profile-head">
            <span class="user-avatar-fallback"><i class="fa-solid fa-circle-user"></i></span>
            <div>
              <h2>${escapeHtml(worker.name || user.display_name || user.username)}</h2>
              <div class="muted">@${escapeHtml(user.username || "")}</div>
            </div>
          </div>
          ${pendingCount > 0
            ? `<div class="worker-profile-panel">
                 <div>
                   <div class="user-field-label">New Bookings</div>
                   <div class="muted">You have ${pendingCount} pending booking(s) waiting for your response.</div>
                 </div>
               </div>`
            : ""}
          <section class="worker-profile-panel">
            <div>
              <span class="booking-status ${workerVerificationState.className}">${escapeHtml(workerVerificationState.text)}</span>
              <div class="muted" style="margin-top:8px">${escapeHtml(workerVerificationState.detail)}</div>
            </div>
          </section>
          <section class="worker-profile-panel">
            <div>
              <div class="user-field-label">Current availability</div>
              <div class="worker-availability-status">${availabilityLabel}</div>
            </div>
            <button id="workerAvailabilityToggle" class="ghost-btn" type="button" data-next-status="${availabilityStatus === "available" ? "unavailable" : "available"}">${availabilityAction}</button>
          </section>
          <form id="workerProfileForm" class="worker-profile-form">
            <div class="user-profile-grid">
              <div class="user-field">
                <label class="user-field-label" for="worker_skill">Skill</label>
                <input id="worker_skill" name="skill" type="text" value="${escapeHtml(worker.skill || "")}" required>
              </div>
              <div class="user-field">
                <label class="user-field-label" for="worker_location">Location</label>
                <input id="worker_location" name="location" type="text" value="${escapeHtml(worker.location || "")}" required>
              </div>
              <div class="user-field">
                <label class="user-field-label" for="worker_price_per_hour">Price per hour</label>
                <input id="worker_price_per_hour" name="price_per_hour" type="number" min="0" step="0.01" value="${escapeHtml(worker.price_per_hour || 0)}" required>
              </div>
              <div class="user-field">
                <label class="user-field-label" for="worker_availability">Availability</label>
                <input id="worker_availability" name="availability" type="text" value="${escapeHtml(availabilityValue)}" placeholder="Mon-Fri, Weekend mornings">
              </div>
            </div>
            <div class="user-field">
              <label class="user-field-label" for="worker_bio">Bio</label>
              <textarea id="worker_bio" name="bio" rows="5" placeholder="Describe your services and experience">${escapeHtml(worker.bio || "")}</textarea>
            </div>
            <div class="user-field">
              <label class="user-field-label" for="worker_portfolio">Portfolio link</label>
              <input id="worker_portfolio" name="portfolio" type="text" value="${escapeHtml(portfolioValue)}" placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg">
            </div>
            <div class="worker-profile-actions">
              <button class="btn" type="submit">Save Worker Profile</button>
              <span id="workerProfileMessage" class="muted"></span>
            </div>
          </form>
          <section class="worker-bookings-section">
            <div class="worker-bookings-head">
              <h2>Received Bookings</h2>
              <span class="muted">${bookings.length} total</span>
            </div>
            <div id="workerBookingsList" class="worker-bookings-list">${bookingsMarkup}</div>
            <p id="workerBookingsMessage" class="muted"></p>
          </section>
          <section class="worker-bookings-section">
            <div class="worker-bookings-head">
              <h2>My Reviews</h2>
              <span class="muted">${(worker.reviews || []).length} total</span>
            </div>
            <div class="worker-bookings-list">
              ${worker.reviews && worker.reviews.length
                ? worker.reviews.map((r) => {
                    const stars = Number(r.rating || 0);
                    return `
                      <article class="worker-booking-card">
                        <div class="worker-booking-head">
                          <h3>${escapeHtml(r.client_name || "Client")}</h3>
                          <span class="booking-status booking-status-approved">
                            ${"★".repeat(stars)}${"☆".repeat(5 - stars)}
                          </span>
                        </div>
                        <p class="worker-booking-desc">${escapeHtml(r.review || "")}</p>
                        <div class="worker-booking-meta muted">
                          ${new Date(r.created_at).toLocaleDateString()}
                        </div>
                      </article>
                    `;
                  }).join("")
                : '<p class="muted">No reviews yet.</p>'
              }
            </div>
          </section>
          <section class="worker-bookings-section">
            <div class="worker-bookings-head">
              <h2>Disputes Against Me</h2>
              <span class="muted">${Array.isArray(workerDisputes) ? workerDisputes.length : 0} total</span>
            </div>
            <div class="worker-bookings-list">${workerDisputesMarkup}</div>
          </section>
        </section>
      `;

      const form = document.getElementById("workerProfileForm");
      const message = document.getElementById("workerProfileMessage");
      const availabilityButton = document.getElementById("workerAvailabilityToggle");
      const bookingsList = document.getElementById("workerBookingsList");
      const bookingsMessage = document.getElementById("workerBookingsMessage");
      if (form && message) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const payload = {
            skill: document.getElementById("worker_skill")?.value || "",
            location: document.getElementById("worker_location")?.value || "",
            price_per_hour: document.getElementById("worker_price_per_hour")?.value || "",
            bio: document.getElementById("worker_bio")?.value || "",
            availability: document.getElementById("worker_availability")?.value || "",
            portfolio: document.getElementById("worker_portfolio")?.value || ""
          };

          const res = await fetch("api/worker/profile/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "same-origin"
          });
          const text = await res.text();
          message.textContent = text;
        });
      }
      if (availabilityButton instanceof HTMLButtonElement) {
        availabilityButton.addEventListener("click", async () => {
          const nextStatus = availabilityButton.dataset.nextStatus || "available";
          const res = await fetch("api/worker/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ available: nextStatus === "available" }),
            credentials: "same-origin"
          });

          if (!res.ok) {
            const text = await res.text();
            if (message) message.textContent = text;
            return;
          }

          await initUserProfile();
        });
      }
      if (bookingsList && bookingsMessage) {
        bookingsList.addEventListener("click", async (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const button = target.closest("[data-booking-status], [data-booking-action]");
          if (!(button instanceof HTMLButtonElement)) return;

          const bookingId = button.dataset.bookingId;
          if (!bookingId) return;

          let res;
          if (button.dataset.bookingAction === "complete") {
            res = await fetch(`api/bookings/${bookingId}/complete`, {
              method: "PATCH",
              credentials: "same-origin"
            });
          } else {
            const status = button.dataset.bookingStatus;
            if (!status) return;
            res = await fetch(`api/worker/bookings/${bookingId}/status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status }),
              credentials: "same-origin"
            });
          }

          const text = await res.text();
          bookingsMessage.textContent = text;
          if (res.ok) await initUserProfile();
        });
      }
      return;
    }

    const accountType = user.role === "worker" ? "Worker" : user.role === "admin" ? "Admin" : "Client";
    const avatar = user.profile_image
      ? `<img class="user-avatar" src="${escapeHtml(user.profile_image)}" alt="${escapeHtml(user.display_name)}">`
      : `<span class="user-avatar-fallback"><i class="fa-solid fa-circle-user"></i></span>`;

    if (user.role === "customer") {
      let bookings = [];
      let disputes = [];
      try {
        bookings = await getJson("api/client/bookings");
      } catch (_error) {
        bookings = [];
      }
      try {
        disputes = await getJson("api/client/disputes");
      } catch (_error) {
        disputes = [];
      }

      const bookingsMarkup = bookings.length
        ? bookings
            .map((booking) => {
              const status = normalizeBookingStatus(booking.status);
              const statusClass = ["pending", "approved", "declined", "completed"].includes(status) ? status : "pending";
              const isCompleted = status === "completed";
              const canShowReviewAction = Boolean(booking.can_review);
              const canShowDisputeAction = ["approved", "completed"].includes(status);
              const clientActionsMarkup = `
                    ${isCompleted ? '<span class="booking-status booking-status-completed">Completed &#10003;</span>' : ""}
                    ${status === "pending" ? `<button class="btn alt" type="button" data-client-booking-action="cancel" data-booking-id="${booking.id}">Cancel</button>` : ""}
                    ${canShowDisputeAction ? `<button class="btn alt" type="button" data-client-booking-action="toggle-dispute" data-booking-id="${booking.id}">Raise Dispute</button>` : ""}
                    ${canShowReviewAction ? `<button class="btn" type="button" data-client-booking-action="toggle-review" data-booking-id="${booking.id}">Leave Review</button>` : ""}
                    ${booking.reviewed ? '<span class="muted">Review submitted</span>' : ""}
                  `;

              return `
                <article class="worker-booking-card">
                  <div class="worker-booking-head">
                    <h3>${escapeHtml(booking.worker_name || `Worker #${booking.worker_id}`)}</h3>
                    <span class="booking-status booking-status-${escapeHtml(statusClass)}">${escapeHtml(status)}</span>
                  </div>
                  <div class="worker-booking-meta">${escapeHtml(booking.date || "")} ${escapeHtml(booking.time || "")}</div>
                  <p class="worker-booking-desc">${escapeHtml(booking.description || "")}</p>
                  <div class="worker-booking-actions client-booking-actions">
                    ${clientActionsMarkup}
                  </div>
                  ${canShowReviewAction
                    ? `<form class="worker-profile-form client-review-form" data-review-form="${booking.id}" data-worker-id="${booking.worker_id}" data-booking-id="${booking.id}" hidden>
                        <div class="user-profile-grid">
                          <div class="user-field">
                            <label class="user-field-label" for="review_rating_${booking.id}">Rating</label>
                            <select id="review_rating_${booking.id}" name="rating" required>
                              <option value="">Select rating</option>
                              <option value="5">5 - Excellent</option>
                              <option value="4">4 - Good</option>
                              <option value="3">3 - Average</option>
                              <option value="2">2 - Fair</option>
                              <option value="1">1 - Poor</option>
                            </select>
                          </div>
                        </div>
                        <div class="user-field">
                          <label class="user-field-label" for="review_text_${booking.id}">Review</label>
                          <textarea id="review_text_${booking.id}" name="review" rows="3" required placeholder="Share your experience"></textarea>
                        </div>
                        <div class="worker-profile-actions">
                          <button class="btn" type="submit">Submit Review</button>
                          <button class="btn alt" type="button" data-client-booking-action="close-review" data-booking-id="${booking.id}">Close</button>
                        </div>
                      </form>`
                    : ""}
                  ${canShowDisputeAction
                    ? `<form class="worker-profile-form client-dispute-form" data-dispute-form="${booking.id}" data-worker-id="${booking.worker_id}" data-booking-id="${booking.id}" hidden>
                        <div class="user-field">
                          <label class="user-field-label" for="dispute_text_${booking.id}">Dispute description</label>
                          <textarea id="dispute_text_${booking.id}" name="description" rows="3" required placeholder="Describe what happened"></textarea>
                        </div>
                        <div class="worker-profile-actions">
                          <button class="btn" type="submit">Submit Dispute</button>
                          <button class="btn alt" type="button" data-client-booking-action="close-dispute" data-booking-id="${booking.id}">Close</button>
                        </div>
                      </form>`
                    : ""}
                </article>
              `;
            })
            .join("")
        : '<p class="muted">No bookings yet.</p>';
      const disputesMarkup = disputes.length
        ? disputes
            .map((dispute) => {
              const status = String(dispute.status || "open").toLowerCase();
              const statusClass = status === "open" ? "pending" : status === "reviewing" ? "approved" : "completed";
              return `
                <article class="worker-booking-card">
                  <div class="worker-booking-head">
                    <h3>${escapeHtml(dispute.worker_name || `Worker #${dispute.against_worker_id || ""}`)}</h3>
                    <span class="booking-status booking-status-${statusClass}">${escapeHtml(status)}</span>
                  </div>
                  <div class="worker-booking-meta">Booking #${escapeHtml(dispute.booking_id || "-")} | ${escapeHtml(formatDate(dispute.created_at))}</div>
                  <p class="worker-booking-desc">${escapeHtml(dispute.description || "")}</p>
                </article>
              `;
            })
            .join("")
        : '<p class="muted">No disputes raised yet.</p>';

      profileCard.innerHTML = `
        <section class="user-profile-wrap">
          <div class="user-profile-head">
            ${avatar}
            <div>
              <h2>${escapeHtml(user.display_name || user.username)}</h2>
              <div class="muted">@${escapeHtml(user.username || "")}</div>
            </div>
          </div>
          <div class="user-profile-grid">
            <div class="user-field">
              <div class="user-field-label">Full name</div>
              <div class="user-field-value">${escapeHtml(user.display_name || "")}</div>
            </div>
            <div class="user-field">
              <div class="user-field-label">Email address</div>
              <div class="user-field-value">${escapeHtml(user.email || "")}</div>
            </div>
            <div class="user-field">
              <div class="user-field-label">Account type</div>
              <div class="user-field-value">Client</div>
            </div>
            <div class="user-field">
              <div class="user-field-label">Profile picture</div>
              <div class="user-field-value">${user.profile_image ? "Uploaded" : "Not set (optional)"}</div>
            </div>
          </div>
          <section class="worker-profile-panel">
            <div>
              <div class="user-field-label">Edit Profile</div>
              <div class="muted">Update your name, email, and password.</div>
            </div>
          </section>
          <form id="clientProfileForm" class="worker-profile-form">
            <div class="user-profile-grid">
              <div class="user-field">
                <label class="user-field-label" for="client_display_name">Display name</label>
                <input id="client_display_name" name="display_name" type="text" value="${escapeHtml(user.display_name || "")}" required>
              </div>
              <div class="user-field">
                <label class="user-field-label" for="client_email">Email</label>
                <input id="client_email" name="email" type="email" value="${escapeHtml(user.email || "")}" required>
              </div>
              <div class="user-field">
                <label class="user-field-label" for="client_current_password">Current password</label>
                <input id="client_current_password" name="current_password" type="password" placeholder="Required only to change password">
              </div>
              <div class="user-field">
                <label class="user-field-label" for="client_new_password">New password</label>
                <input id="client_new_password" name="new_password" type="password" placeholder="Leave blank to keep current password">
              </div>
            </div>
            <div class="worker-profile-actions">
              <button class="btn" type="submit">Save Profile</button>
              <span id="clientProfileMessage" class="muted"></span>
            </div>
          </form>
          <section class="worker-bookings-section">
            <div class="worker-bookings-head">
              <h2>Booking History</h2>
              <span class="muted">${bookings.length} total</span>
            </div>
            <div id="clientBookingsList" class="worker-bookings-list">${bookingsMarkup}</div>
            <p id="clientBookingsMessage" class="muted"></p>
          </section>
          <section class="worker-bookings-section">
            <div class="worker-bookings-head">
              <h2>My Disputes</h2>
              <span class="muted">${disputes.length} total</span>
            </div>
            <div id="clientDisputesList" class="worker-bookings-list">${disputesMarkup}</div>
            <p id="clientDisputesMessage" class="muted"></p>
          </section>
        </section>
      `;

      const clientProfileForm = document.getElementById("clientProfileForm");
      const clientProfileMessage = document.getElementById("clientProfileMessage");
      const clientBookingsList = document.getElementById("clientBookingsList");
      const clientBookingsMessage = document.getElementById("clientBookingsMessage");
      const clientDisputesMessage = document.getElementById("clientDisputesMessage");

      if (clientProfileForm && clientProfileMessage) {
        clientProfileForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const payload = {
            display_name: document.getElementById("client_display_name")?.value || "",
            email: document.getElementById("client_email")?.value || "",
            current_password: document.getElementById("client_current_password")?.value || "",
            new_password: document.getElementById("client_new_password")?.value || ""
          };

          const res = await fetch("api/client/profile/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "same-origin"
          });
          const text = await res.text();
          clientProfileMessage.textContent = text;

          if (res.ok) {
            await initUserProfile();
          }
        });
      }

      if (clientBookingsList && clientBookingsMessage) {
        clientBookingsList.addEventListener("click", async (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const actionButton = target.closest("[data-client-booking-action]");
          if (!(actionButton instanceof HTMLButtonElement)) return;

          const action = actionButton.dataset.clientBookingAction;
          const bookingId = Number(actionButton.dataset.bookingId || 0);
          if (!action || !bookingId) return;

          if (action === "toggle-review") {
            const reviewForm = clientBookingsList.querySelector(`[data-review-form="${bookingId}"]`);
            if (!(reviewForm instanceof HTMLFormElement)) return;
            reviewForm.hidden = !reviewForm.hidden;
            return;
          }

          if (action === "close-review") {
            const reviewForm = clientBookingsList.querySelector(`[data-review-form="${bookingId}"]`);
            if (reviewForm instanceof HTMLFormElement) reviewForm.hidden = true;
            return;
          }

          if (action === "toggle-dispute") {
            const disputeForm = clientBookingsList.querySelector(`[data-dispute-form="${bookingId}"]`);
            if (!(disputeForm instanceof HTMLFormElement)) return;
            disputeForm.hidden = !disputeForm.hidden;
            return;
          }

          if (action === "close-dispute") {
            const disputeForm = clientBookingsList.querySelector(`[data-dispute-form="${bookingId}"]`);
            if (disputeForm instanceof HTMLFormElement) disputeForm.hidden = true;
            return;
          }

          if (action === "cancel") {
            const res = await fetch(`api/client/bookings/${bookingId}/cancel`, {
              method: "POST",
              credentials: "same-origin"
            });
            const text = await res.text();
            clientBookingsMessage.textContent = text;
            if (res.ok) await initUserProfile();
          }
        });

        clientBookingsList.addEventListener("submit", async (event) => {
          const target = event.target;
          if (!(target instanceof HTMLFormElement)) return;
          if (!target.matches("[data-review-form]")) return;

          event.preventDefault();
          const bookingId = Number(target.dataset.bookingId || 0);
          const workerId = Number(target.dataset.workerId || 0);
          if (!bookingId || !workerId) return;

          const formData = new FormData(target);
          const payload = {
            booking_id: bookingId,
            rating: Number(formData.get("rating") || 0),
            review: String(formData.get("review") || "")
          };

          const res = await fetch(`api/worker/${workerId}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "same-origin"
          });

          const contentType = res.headers.get("content-type") || "";
          const message = contentType.includes("application/json")
            ? (await res.json()).message || "Review submitted"
            : await res.text();
          clientBookingsMessage.textContent = message;

          if (res.ok) await initUserProfile();
        });

        clientBookingsList.addEventListener("submit", async (event) => {
          const target = event.target;
          if (!(target instanceof HTMLFormElement)) return;
          if (!target.matches("[data-dispute-form]")) return;

          event.preventDefault();
          const bookingId = Number(target.dataset.bookingId || 0);
          const workerId = Number(target.dataset.workerId || 0);
          if (!bookingId || !workerId) return;

          const formData = new FormData(target);
          const payload = {
            booking_id: bookingId,
            against_worker_id: workerId,
            description: String(formData.get("description") || "")
          };

          const res = await fetch("api/client/disputes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            credentials: "same-origin"
          });

          const text = await res.text();
          if (clientDisputesMessage) clientDisputesMessage.textContent = text;
          if (res.ok) await initUserProfile();
        });
      }
      return;
    }

    let adminStats = { clients: 0, workers: 0, bookings: 0, pending_verifications: 0 };
    try { adminStats = await getJson("api/admin/stats"); } catch (_) {}

    profileCard.innerHTML = `
      <section class="user-profile-wrap">
        <div class="user-profile-head">
          ${avatar}
          <div>
            <h2>${escapeHtml(user.display_name || user.username)}</h2>
            <div class="muted">@${escapeHtml(user.username)}</div>
            <span class="booking-status booking-status-approved" style="margin-top:6px;display:inline-block">Administrator</span>
          </div>
        </div>
        <div class="user-profile-grid">
          <div class="user-field">
            <div class="user-field-label">Full name</div>
            <div class="user-field-value">${escapeHtml(user.display_name || "")}</div>
          </div>
          <div class="user-field">
            <div class="user-field-label">Email address</div>
            <div class="user-field-value">${escapeHtml(user.email || "")}</div>
          </div>
          <div class="user-field">
            <div class="user-field-label">Account type</div>
            <div class="user-field-value">Admin</div>
          </div>
          <div class="user-field">
            <div class="user-field-label">Profile picture</div>
            <div class="user-field-value">${user.profile_image ? "Uploaded" : "Not set (optional)"}</div>
          </div>
        </div>
        <section class="worker-profile-panel" style="margin-top:18px">
          <div>
            <div class="user-field-label">Change Password</div>
            <div class="muted">Update your admin account password.</div>
          </div>
        </section>
        <form id="adminPasswordForm" class="worker-profile-form">
          <div class="user-profile-grid">
            <div class="user-field">
              <label class="user-field-label" for="admin_current_password">Current password</label>
              <input id="admin_current_password" name="current_password" type="password" placeholder="Current password">
            </div>
            <div class="user-field">
              <label class="user-field-label" for="admin_new_password">New password</label>
              <input id="admin_new_password" name="new_password" type="password" placeholder="New password">
            </div>
          </div>
          <div class="worker-profile-actions">
            <button class="btn" type="submit">Change Password</button>
            <span id="adminPasswordMessage" class="muted"></span>
          </div>
        </form>
        <section class="worker-bookings-section" style="margin-top:18px">
          <div class="worker-bookings-head" style="margin-bottom:14px">
            <h2>Admin Panel</h2>
          </div>
          <div class="admin-stats-grid" style="margin-bottom:18px">
            <article class="admin-stat-card">
              <span>Total Clients</span>
              <strong>${adminStats.clients}</strong>
            </article>
            <article class="admin-stat-card">
              <span>Total Workers</span>
              <strong>${adminStats.workers}</strong>
            </article>
            <article class="admin-stat-card">
              <span>Total Bookings</span>
              <strong>${adminStats.bookings}</strong>
            </article>
            <article class="admin-stat-card">
              <span>Pending Verifications</span>
              <strong>${adminStats.pending_verifications}</strong>
            </article>
          </div>
          <a class="btn" href="admin.html">Go to Admin Dashboard &rarr;</a>
        </section>
      </section>
    `;

    const adminPasswordForm = document.getElementById("adminPasswordForm");
    const adminPasswordMessage = document.getElementById("adminPasswordMessage");
    if (adminPasswordForm && adminPasswordMessage) {
      adminPasswordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = {
          display_name: user.display_name || user.username,
          email: user.email,
          current_password: document.getElementById("admin_current_password")?.value || "",
          new_password: document.getElementById("admin_new_password")?.value || ""
        };
        const res = await fetch("api/client/profile/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "same-origin"
        });
        adminPasswordMessage.textContent = await res.text();
      });
    }
  } catch (_error) {
    profileCard.innerHTML = "<p class='muted'>Unable to load profile. Please try again.</p>";
  }
}

async function initProfile() {
  const workerIdParam = queryParam("id");
  if (workerIdParam) {
    const workerId = Number(workerIdParam);
    if (!workerId) {
      const profileCard = document.getElementById("profileCard");
      if (profileCard) profileCard.innerHTML = "<p class='muted'>Invalid worker ID.</p>";
      return;
    }
    await initWorkerProfile(workerId);
    return;
  }
  await initUserProfile();
}

async function initBooking() {
  const form = document.getElementById("bookingForm");
  const message = document.getElementById("bookingMessage");
  const card = document.getElementById("bookingWorkerCard");
  const title = document.getElementById("bookingTitle");
  if (!form || !message || !card) return;

  const workerId = Number(queryParam("worker")) || 1;
  const session = await getJson("api/auth/session");
  if (!session.logged_in) {
    window.location.href = `login.html?redirect=booking.html?worker=${workerId}`;
    return;
  }
  let worker;
  try {
    worker = await getJson(`api/workers/${workerId}`);
  } catch (_error) {
    card.innerHTML = "<p class='muted'>Worker not found.</p>";
    return;
  }

  const workerIdInput = document.getElementById("worker_id");
  if (workerIdInput) workerIdInput.value = String(worker.id);
  if (title) title.textContent = `Book Service with ${worker.name}`;
  const dateInput = document.getElementById("date");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;
    if (!dateInput.value) dateInput.value = today;
  }

  card.innerHTML = `
    <img src="${escapeHtml(getCardImage(worker))}" alt="${escapeHtml(worker.name)}">
    <h3>${escapeHtml(worker.name)}</h3>
    <div class="worker-skill">${escapeHtml(worker.skill)}</div>
    <div class="worker-meta">* ${worker.rating} (${(worker.reviews || []).length} reviews)</div>
    <div class="worker-meta">KSh ${worker.price_per_hour}/hour</div>
    <div class="availability">Available Today</div>
  `;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      worker_id: worker.id,
      client_name: document.getElementById("full_name")?.value || "",
      client_phone: document.getElementById("client_phone")?.value || "",
      date: document.getElementById("date")?.value || "",
      time: document.getElementById("time")?.value || "",
      description: document.getElementById("description")?.value || "",
      client_email: document.getElementById("client_email")?.value || "",
      service_address: document.getElementById("service_address")?.value || ""
    };

    const res = await fetch("api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin"
    });

    const text = await res.text();
    message.textContent = text;
    if (res.ok) {
      form.reset();
      if (workerIdInput) workerIdInput.value = String(worker.id);
    }
  });
}

function initLogin() {
  const form = document.getElementById("loginForm");
  const message = document.getElementById("loginMessage");
  if (!form || !message) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(form).entries());
    const res = await fetch("api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin"
    });
    const text = await res.text();
    message.textContent = text;
    if (res.ok) {
      const redirect = new URL(window.location.href).searchParams.get("redirect");
      window.location.href = redirect || "index.html";
    }
  });
}

function getPasswordRequirementState(passwordValue) {
  const password = String(passwordValue || "");
  return {
    length: password.length >= 6,
    case: /[a-z]/.test(password) && /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password)
  };
}

function initRegister() {
  const form = document.getElementById("registerForm");
  const message = document.getElementById("registerMessage");
  if (!form || !message) return;

  const passwordInput = document.getElementById("password") || document.getElementById("reg_password");
  const requirementRows = {
    length: document.getElementById("req-length"),
    case: document.getElementById("req-case"),
    number: document.getElementById("req-number"),
    symbol: document.getElementById("req-symbol")
  };

  const hasRequirementRows = Object.values(requirementRows).every((row) => row instanceof HTMLElement);
  const updateRequirementRow = (row, met) => {
    if (!(row instanceof HTMLElement)) return;
    row.classList.toggle("valid", met);
    row.classList.toggle("invalid", !met);
    const icon = row.querySelector(".req-icon");
    if (icon) icon.textContent = met ? "✓" : "✗";
  };

  const updatePasswordRequirementUi = () => {
    if (!(passwordInput instanceof HTMLInputElement)) return true;
    const state = getPasswordRequirementState(passwordInput.value);
    const allMet = Object.values(state).every(Boolean);

    if (hasRequirementRows) {
      updateRequirementRow(requirementRows.length, state.length);
      updateRequirementRow(requirementRows.case, state.case);
      updateRequirementRow(requirementRows.number, state.number);
      updateRequirementRow(requirementRows.symbol, state.symbol);
    }

    passwordInput.classList.toggle("pw-valid", allMet);
    passwordInput.classList.toggle("pw-invalid", !allMet);
    return allMet;
  };

  if (passwordInput instanceof HTMLInputElement) {
    updatePasswordRequirementUi();
    passwordInput.addEventListener("input", updatePasswordRequirementUi);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const allRequirementsMet = updatePasswordRequirementUi();
    if (!allRequirementsMet) {
      message.textContent = "Password does not meet all requirements.";
      window.alert("Please meet all password requirements before submitting.");
      return;
    }

    const payload = {
      display_name: document.getElementById("display_name")?.value || "",
      username: document.getElementById("reg_username")?.value || "",
      email: document.getElementById("email")?.value || "",
      password: passwordInput instanceof HTMLInputElement ? passwordInput.value : "",
      role: document.getElementById("account_role")?.value || ""
    };
    const res = await fetch("api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin"
    });
    const text = await res.text();
    message.textContent = text;
    if (res.ok) window.location.href = "index.html";
  });
}

function initPasswordToggles() {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest(".pw-toggle");
    if (!(toggle instanceof HTMLElement)) return;

    const inputId = toggle.getAttribute("data-target");
    if (!inputId) return;
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;

    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggle.innerHTML = isHidden
      ? '<i class="fa-solid fa-eye-slash"></i>'
      : '<i class="fa-solid fa-eye"></i>';
    toggle.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  });
}

async function initAdmin() {
  const messageBox = document.getElementById("adminMessage");
  const overviewLoading = document.getElementById("overviewLoading");
  const workersLoading = document.getElementById("workersLoading");
  const clientsLoading = document.getElementById("clientsLoading");
  const bookingsLoading = document.getElementById("bookingsLoading");

  const statClients = document.getElementById("statClients");
  const statWorkers = document.getElementById("statWorkers");
  const statBookings = document.getElementById("statBookings");
  const statPending = document.getElementById("statPending");

  const workersSearch = document.getElementById("workersSearch");
  const workersVerifiedFilter = document.getElementById("workersVerifiedFilter");
  const workersTableBody = document.getElementById("workersTableBody");

  const clientsSearch = document.getElementById("clientsSearch");
  const clientsTableBody = document.getElementById("clientsTableBody");

  const bookingsStatusFilter = document.getElementById("bookingsStatusFilter");
  const bookingsTableBody = document.getElementById("bookingsTableBody");
  const pendingTableBody = document.getElementById("pendingTableBody");
  const disputesTableBody = document.getElementById("disputesTableBody");
  const auditTableBody = document.getElementById("auditTableBody");
  const pendingLoading = document.getElementById("pendingLoading");
  const disputesLoading = document.getElementById("disputesLoading");
  const auditLoading = document.getElementById("auditLoading");

  if (
    !messageBox ||
    !overviewLoading ||
    !workersLoading ||
    !clientsLoading ||
    !bookingsLoading ||
    !statClients ||
    !statWorkers ||
    !statBookings ||
    !statPending ||
    !workersSearch ||
    !workersVerifiedFilter ||
    !workersTableBody ||
    !clientsSearch ||
    !clientsTableBody ||
    !bookingsStatusFilter ||
    !bookingsTableBody
  ) {
    return;
  }

  const state = {
    stats: null,
    workers: [],
    clients: [],
    bookings: [],
    pendingWorkers: [],
    disputes: [],
    auditLogs: []
  };

  const formatDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString();
  };

  const setLoading = (isLoading) => {
    const text = isLoading ? "Loading..." : "";
    overviewLoading.textContent = text;
    workersLoading.textContent = text;
    clientsLoading.textContent = text;
    bookingsLoading.textContent = text;
    if (pendingLoading) pendingLoading.textContent = text;
    if (disputesLoading) disputesLoading.textContent = text;
    if (auditLoading) auditLoading.textContent = text;
  };

  const setMessage = (text, type = "info") => {
    messageBox.textContent = text || "";
    messageBox.className = "admin-message";
    if (!text) {
      messageBox.classList.add("muted");
      return;
    }
    if (type === "success") {
      messageBox.classList.add("admin-message-success");
      return;
    }
    if (type === "error") {
      messageBox.classList.add("admin-message-error");
      return;
    }
    messageBox.classList.add("muted");
  };

  const renderWorkers = () => {
    const term = workersSearch.value.trim().toLowerCase();
    const verifiedFilter = workersVerifiedFilter.value;
    const list = state.workers.filter((worker) => {
      const matchesSearch =
        !term ||
        String(worker.name || "").toLowerCase().includes(term) ||
        String(worker.skill || "").toLowerCase().includes(term);
      const matchesVerified =
        verifiedFilter === "all" ||
        (verifiedFilter === "verified" && worker.verified) ||
        (verifiedFilter === "unverified" && !worker.verified);
      return matchesSearch && matchesVerified;
    });

    workersTableBody.innerHTML = list.length
      ? list
          .map(
            (worker) => `
              <tr>
                <td>${escapeHtml(worker.name || "")}</td>
                <td>${escapeHtml(worker.skill || "")}</td>
                <td>${escapeHtml(worker.location || "")}</td>
                <td>${worker.verified ? "Verified" : "Unverified"}</td>
                <td>${escapeHtml(formatDate(worker.created_at))}</td>
                <td>
                  <div class="admin-row-actions">
                    ${worker.verified ? "" : `<button class="btn" type="button" data-worker-action="verify" data-worker-id="${worker.id}">Verify</button>`}
                    <button class="btn alt" type="button" data-worker-action="delete" data-worker-id="${worker.id}">Delete</button>
                  </div>
                </td>
              </tr>
            `
          )
          .join("")
      : '<tr><td colspan="6" class="muted">No workers found.</td></tr>';
  };

  const renderClients = () => {
    const term = clientsSearch.value.trim().toLowerCase();
    const list = state.clients.filter((client) => {
      if (!term) return true;
      const fullName = String(client.display_name || "").toLowerCase();
      const email = String(client.email || "").toLowerCase();
      const username = String(client.username || "").toLowerCase();
      return fullName.includes(term) || email.includes(term) || username.includes(term);
    });

    clientsTableBody.innerHTML = list.length
      ? list
          .map(
            (client) => `
              <tr>
                <td>${escapeHtml(client.display_name || client.username || "")}</td>
                <td>${escapeHtml(client.email || "")}</td>
                <td>${escapeHtml(client.role || "")}</td>
                <td>${escapeHtml(formatDate(client.created_at))}</td>
                <td>
                  ${
                    client.role === "admin"
                      ? '<span class="muted">Protected</span>'
                      : `<button class="btn alt" type="button" data-client-action="delete" data-client-id="${client.id}">Delete</button>`
                  }
                </td>
              </tr>
            `
          )
          .join("")
      : '<tr><td colspan="5" class="muted">No clients found.</td></tr>';
  };

  const renderBookings = () => {
    const statusFilter = bookingsStatusFilter.value;
    const list = state.bookings.filter((booking) => {
      if (statusFilter === "all") return true;
      return normalizeBookingStatus(booking.status) === statusFilter;
    });

    bookingsTableBody.innerHTML = list.length
      ? list
          .map((booking) => {
            const status = normalizeBookingStatus(booking.status);
            return `
              <tr>
                <td>${escapeHtml(booking.worker_name || "")}</td>
                <td>${escapeHtml(booking.client_name || "")}</td>
                <td>${escapeHtml(booking.date || "")}</td>
                <td>${escapeHtml(booking.time || "")}</td>
                <td>${escapeHtml(booking.description || "")}</td>
                <td><span class="booking-status booking-status-${escapeHtml(status)}">${escapeHtml(status)}</span></td>
                <td>
                  <div class="admin-row-actions">
                    <select class="admin-inline-select" data-booking-status-select data-booking-id="${booking.id}">
                      <option value="pending" ${status === "pending" ? "selected" : ""}>Pending</option>
                      <option value="approved" ${status === "approved" ? "selected" : ""}>Approved</option>
                      <option value="declined" ${status === "declined" ? "selected" : ""}>Declined</option>
                      <option value="completed" ${status === "completed" ? "selected" : ""}>Completed</option>
                    </select>
                    <button class="btn" type="button" data-booking-action="update" data-booking-id="${booking.id}">Update</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="7" class="muted">No bookings found.</td></tr>';
  };

  const renderPendingWorkers = () => {
    if (!pendingTableBody) return;
    pendingTableBody.innerHTML = state.pendingWorkers.length
      ? state.pendingWorkers.map((worker) => `
          <tr>
            <td>${escapeHtml(worker.name || "")}</td>
            <td>${escapeHtml(worker.skill || "")}</td>
            <td>${escapeHtml(worker.location || "")}</td>
            <td>${escapeHtml(formatDate(worker.created_at))}</td>
            <td>
              <div class="admin-row-actions">
                <button class="btn" type="button" data-pending-action="approve" data-worker-id="${worker.id}">Approve</button>
                <button class="btn alt" type="button" data-pending-action="reject" data-worker-id="${worker.id}">Reject</button>
                <div class="admin-reject-form" id="rejectForm-${worker.id}" hidden style="display:flex;gap:8px;align-items:center;margin-top:6px">
                  <input class="admin-inline-select" type="text" placeholder="Rejection reason" id="rejectReason-${worker.id}">
                  <button class="btn alt" type="button" data-pending-action="confirm-reject" data-worker-id="${worker.id}">Confirm</button>
                </div>
              </div>
            </td>
          </tr>`).join("")
      : '<tr><td colspan="5" class="muted">No pending verifications.</td></tr>';
  };

  const renderDisputes = () => {
    if (!disputesTableBody) return;
    disputesTableBody.innerHTML = state.disputes.length
      ? state.disputes.map((dispute) => {
          const status = String(dispute.status || "open").toLowerCase();
          return `
            <tr>
              <td>${Number(dispute.id)}</td>
              <td>${escapeHtml(dispute.worker_name || "")}</td>
              <td>${escapeHtml(dispute.client_name || "")}</td>
              <td>${escapeHtml(dispute.description || "")}</td>
              <td><span class="booking-status booking-status-${status === "open" ? "pending" : status === "reviewing" ? "approved" : "declined"}">${escapeHtml(status)}</span></td>
              <td>${escapeHtml(formatDate(dispute.created_at))}</td>
              <td>
                <div class="admin-row-actions">
                  <select class="admin-inline-select" data-dispute-status-select data-dispute-id="${dispute.id}">
                    <option value="open" ${status === "open" ? "selected" : ""}>Open</option>
                    <option value="reviewing" ${status === "reviewing" ? "selected" : ""}>Reviewing</option>
                    <option value="resolved" ${status === "resolved" ? "selected" : ""}>Resolved</option>
                  </select>
                  <button class="btn" type="button" data-dispute-action="update" data-dispute-id="${dispute.id}">Update</button>
                </div>
              </td>
            </tr>`;
        }).join("")
      : '<tr><td colspan="7" class="muted">No disputes found.</td></tr>';
  };

  const renderAuditLog = () => {
    if (!auditTableBody) return;
    auditTableBody.innerHTML = state.auditLogs.length
      ? state.auditLogs.map((entry) => `
          <tr>
            <td>${escapeHtml(entry.action || "")}</td>
            <td>${escapeHtml(entry.target_type || "-")}</td>
            <td>${entry.target_id ? Number(entry.target_id) : "-"}</td>
            <td>${escapeHtml(entry.detail || "-")}</td>
            <td>${escapeHtml(formatDate(entry.created_at))}</td>
          </tr>`).join("")
      : '<tr><td colspan="5" class="muted">No audit entries yet.</td></tr>';
  };

  const renderAll = () => {
    statClients.textContent = String(state.stats?.clients ?? 0);
    statWorkers.textContent = String(state.stats?.workers ?? 0);
    statBookings.textContent = String(state.stats?.bookings ?? 0);
    statPending.textContent = String(state.stats?.pending_verifications ?? 0);
    renderWorkers();
    renderClients();
    renderBookings();
    renderPendingWorkers();
    renderDisputes();
    renderAuditLog();
  };

  const loadAdminData = async () => {
    setLoading(true);
    workersTableBody.innerHTML = '<tr><td colspan="6" class="muted">Loading workers...</td></tr>';
    clientsTableBody.innerHTML = '<tr><td colspan="5" class="muted">Loading clients...</td></tr>';
    bookingsTableBody.innerHTML = '<tr><td colspan="7" class="muted">Loading bookings...</td></tr>';
    if (pendingTableBody) pendingTableBody.innerHTML = '<tr><td colspan="5" class="muted">Loading pending workers...</td></tr>';
    if (disputesTableBody) disputesTableBody.innerHTML = '<tr><td colspan="7" class="muted">Loading disputes...</td></tr>';
    if (auditTableBody) auditTableBody.innerHTML = '<tr><td colspan="5" class="muted">Loading audit logs...</td></tr>';
    try {
      const [stats, workers, clients, bookings, pendingWorkers, disputes, auditLogs] = await Promise.all([
        getJson("api/admin/stats"),
        getJson("api/admin/workers"),
        getJson("api/admin/clients"),
        getJson("api/admin/bookings"),
        getJson("api/admin/pending-workers"),
        getJson("api/admin/disputes"),
        getJson("api/admin/audit-logs")
      ]);
      state.stats = stats;
      state.workers = Array.isArray(workers) ? workers : [];
      state.clients = Array.isArray(clients) ? clients : [];
      state.bookings = Array.isArray(bookings) ? bookings : [];
      state.pendingWorkers = Array.isArray(pendingWorkers) ? pendingWorkers : [];
      state.disputes = Array.isArray(disputes) ? disputes : [];
      state.auditLogs = Array.isArray(auditLogs) ? auditLogs : [];
      renderAll();
    } finally {
      setLoading(false);
    }
  };

  const ensureAdminAccess = async () => {
    const res = await fetch("api/admin", { credentials: "same-origin" });
    if (res.status === 403) {
      window.location.href = "index.html";
      return false;
    }
    return res.ok;
  };

  if (!(await ensureAdminAccess())) {
    setMessage("Unable to verify admin session.", "error");
    return;
  }

  try {
    await loadAdminData();
  } catch (_error) {
    setMessage("Failed to load admin dashboard data.", "error");
  }

  workersSearch.addEventListener("input", renderWorkers);
  workersVerifiedFilter.addEventListener("change", renderWorkers);
  clientsSearch.addEventListener("input", renderClients);
  bookingsStatusFilter.addEventListener("change", renderBookings);

  workersTableBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const actionButton = target.closest("[data-worker-action]");
    if (!(actionButton instanceof HTMLButtonElement)) return;

    const action = actionButton.dataset.workerAction;
    const workerId = Number(actionButton.dataset.workerId || 0);
    if (!action || !workerId) return;

    if (action === "verify") {
      const res = await fetch("api/workers/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workerId }),
        credentials: "same-origin"
      });
      const text = await res.text();
      setMessage(text, res.ok ? "success" : "error");
      if (res.ok) await loadAdminData();
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm("Delete this worker and related bookings?");
      if (!confirmed) return;
      const res = await fetch(`api/admin/workers/${workerId}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const text = await res.text();
      setMessage(text, res.ok ? "success" : "error");
      if (res.ok) await loadAdminData();
    }
  });

  clientsTableBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const actionButton = target.closest("[data-client-action]");
    if (!(actionButton instanceof HTMLButtonElement)) return;

    const action = actionButton.dataset.clientAction;
    const clientId = Number(actionButton.dataset.clientId || 0);
    if (action !== "delete" || !clientId) return;

    const confirmed = window.confirm("Delete this client account?");
    if (!confirmed) return;

    const res = await fetch(`api/admin/clients/${clientId}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    const text = await res.text();
    setMessage(text, res.ok ? "success" : "error");
    if (res.ok) await loadAdminData();
  });

  bookingsTableBody.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const actionButton = target.closest("[data-booking-action]");
    if (!(actionButton instanceof HTMLButtonElement)) return;

    const action = actionButton.dataset.bookingAction;
    const bookingId = Number(actionButton.dataset.bookingId || 0);
    if (action !== "update" || !bookingId) return;

    const select = bookingsTableBody.querySelector(`[data-booking-status-select][data-booking-id="${bookingId}"]`);
    if (!(select instanceof HTMLSelectElement)) return;

    const res = await fetch(`api/admin/bookings/${bookingId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: select.value }),
      credentials: "same-origin"
    });
    const text = await res.text();
    setMessage(text, res.ok ? "success" : "error");
    if (res.ok) await loadAdminData();
  });

  if (pendingTableBody) {
    pendingTableBody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("[data-pending-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const action = btn.dataset.pendingAction;
      const workerId = Number(btn.dataset.workerId || 0);
      if (!workerId) return;

      if (action === "approve") {
        const res = await fetch("api/workers/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: workerId }),
          credentials: "same-origin"
        });
        setMessage(await res.text(), res.ok ? "success" : "error");
        if (res.ok) await loadAdminData();
        return;
      }

      if (action === "reject") {
        const rejectForm = document.getElementById(`rejectForm-${workerId}`);
        if (rejectForm) rejectForm.hidden = !rejectForm.hidden;
        return;
      }

      if (action === "confirm-reject") {
        const reason = document.getElementById(`rejectReason-${workerId}`)?.value || "";
        const res = await fetch(`api/admin/workers/${workerId}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
          credentials: "same-origin"
        });
        setMessage(await res.text(), res.ok ? "success" : "error");
        if (res.ok) await loadAdminData();
      }
    });
  }

  if (disputesTableBody) {
    disputesTableBody.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest("[data-dispute-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      const action = btn.dataset.disputeAction;
      const disputeId = Number(btn.dataset.disputeId || 0);
      if (action !== "update" || !disputeId) return;
      const select = disputesTableBody.querySelector(`[data-dispute-status-select][data-dispute-id="${disputeId}"]`);
      if (!(select instanceof HTMLSelectElement)) return;
      const res = await fetch(`api/admin/disputes/${disputeId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: select.value }),
        credentials: "same-origin"
      });
      setMessage(await res.text(), res.ok ? "success" : "error");
      if (res.ok) await loadAdminData();
    });
  }
}

function initForgotPassword() {
  const form = document.getElementById("forgotPasswordForm");
  const message = document.getElementById("forgotPasswordMessage");
  if (!form || !message) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("forgot_email")?.value || "";
    message.textContent = "Sending...";
    const res = await fetch("api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      credentials: "same-origin"
    });
    message.textContent = await res.text();
  });
}

async function initResetPassword() {
  const tokenStatus = document.getElementById("resetTokenStatus");
  const form = document.getElementById("resetPasswordForm");
  const message = document.getElementById("resetPasswordMessage");
  if (!tokenStatus || !form || !message) return;

  const token = new URL(window.location.href).searchParams.get("token");
  if (!token) {
    tokenStatus.textContent = "Invalid reset link. Please request a new one.";
    return;
  }

  const tokenInput = document.getElementById("reset_token");
  if (tokenInput) tokenInput.value = token;

  try {
    const res = await fetch(`api/auth/verify-reset-token?token=${encodeURIComponent(token)}`, {
      credentials: "same-origin"
    });
    const data = await res.json();
    if (!data.valid) {
      tokenStatus.textContent = data.error || "This reset link is invalid or has expired. Please request a new one.";
      return;
    }
    tokenStatus.textContent = "";
    form.hidden = false;
  } catch (_error) {
    tokenStatus.textContent = "Unable to verify reset link. Please try again.";
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = document.getElementById("reset_password")?.value || "";
    const confirm = document.getElementById("reset_confirm_password")?.value || "";

    if (password.length < 6) {
      message.textContent = "Password must be at least 6 characters.";
      return;
    }
    if (password !== confirm) {
      message.textContent = "Passwords do not match.";
      return;
    }

    const res = await fetch("api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
      credentials: "same-origin"
    });
    const text = await res.text();
    message.textContent = text;
    if (res.ok) {
      setTimeout(() => {
        window.location.href = "login.html";
      }, 2000);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const page = document.body.dataset.page;
  try {
    await initAuthNav();
    initPasswordToggles();
    if (page === "home") await initHome();
    if (page === "profile") await initProfile();
    if (page === "booking") await initBooking();
    if (page === "login") initLogin();
    if (page === "register") initRegister();
    if (page === "forgot-password") initForgotPassword();
    if (page === "reset-password") await initResetPassword();
    if (page === "admin") await initAdmin();
  } catch (error) {
    console.error(error);
  }
});


