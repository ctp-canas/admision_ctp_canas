"use strict";

(function admissionApplication() {
  const config = window.APP_CONFIG || {};
  const page = document.body.dataset.page;
  const isConfigured =
    typeof config.supabaseUrl === "string" &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.supabaseUrl) &&
    typeof config.supabasePublishableKey === "string" &&
    !config.supabasePublishableKey.startsWith("SU-") &&
    config.supabasePublishableKey.length > 20;

  let client = null;
  if (isConfigured && window.supabase?.createClient) {
    client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );
  }

  const byId = (id) => document.getElementById(id);

  function setMessage(element, message, type = "error") {
    if (!element) return;
    element.textContent = message;
    element.dataset.type = type;
    element.classList.remove("d-none");
  }

  function clearMessage(element) {
    if (!element) return;
    element.textContent = "";
    element.classList.add("d-none");
    delete element.dataset.type;
  }

  function setBusy(button, busy, busyLabel = "Procesando…") {
    if (!button) return;
    const label = button.querySelector(".button-label");
    const spinner = button.querySelector(".spinner-border");
    button.disabled = busy;
    if (label) {
      if (!label.dataset.defaultLabel) label.dataset.defaultLabel = label.textContent;
      label.textContent = busy ? busyLabel : label.dataset.defaultLabel;
    }
    spinner?.classList.toggle("d-none", !busy);
    button.setAttribute("aria-busy", String(busy));
  }

  function normalizeId(value) {
    return String(value ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "");
  }

  function adminUsernameToEmail(value) {
    const username = normalizeId(value);
    const domain = String(config.adminLoginDomain || "admin.ctpcanas.invalid")
      .trim()
      .toLowerCase();
    return `${username}@${domain}`;
  }

  function formatCostaRicaDate(value, includeWeekday = true) {
    if (!value) return "sin definir";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "fecha no válida";
    return new Intl.DateTimeFormat("es-CR", {
      timeZone: config.zonaHoraria || "America/Costa_Rica",
      weekday: includeWeekday ? "long" : undefined,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function toCostaRicaInput(value) {
    if (!value) return "";
    const date = new Date(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: config.zonaHoraria || "America/Costa_Rica",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
  }

  function fromCostaRicaInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
    const date = new Date(`${value}:00-06:00`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function friendlyError(error, fallback) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("failed to fetch") || message.includes("network")) {
      return "No fue posible conectarse con el sistema. Revise la conexión a Internet e inténtelo nuevamente.";
    }
    if (message.includes("jwt") || message.includes("session")) {
      return "La sesión venció. Ingrese nuevamente para continuar.";
    }
    if (message.includes("no autorizado") || message.includes("permission denied")) {
      return "La cuenta no tiene autorización para realizar esta acción.";
    }
    return fallback;
  }

  function setupPasswordToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = byId(button.dataset.passwordToggle);
        if (!input) return;
        const shouldShow = input.type === "password";
        input.type = shouldShow ? "text" : "password";
        button.textContent = shouldShow ? "Ocultar" : "Mostrar";
        button.setAttribute("aria-label", shouldShow ? "Ocultar contraseña" : "Mostrar contraseña");
        button.setAttribute("aria-pressed", String(shouldShow));
        input.focus();
      });
    });
  }

  function showConfigurationWarning(alertElement) {
    setMessage(
      alertElement,
      "El sitio está listo, pero falta conectar el proyecto de Supabase en el archivo config.js. Consulte el README antes de publicarlo.",
      "info"
    );
  }

  async function initializeStudentPage() {
    const form = byId("student-form");
    const consultButton = byId("consult-button");
    const availabilityCard = byId("availability-card");
    const availabilityTitle = byId("availability-title");
    const availabilityMessage = byId("availability-message");
    const formMessage = byId("form-message");
    const resultCard = byId("result-card");
    const resultPlaceholder = byId("result-placeholder");
    const resultContent = byId("result-content");
    let systemOpen = false;

    byId("current-year").textContent = String(new Date().getFullYear());

    function updateAvailability(state, title, message) {
      availabilityCard.dataset.state = state;
      availabilityTitle.textContent = title;
      availabilityMessage.textContent = message;
      const icon = byId("availability-icon");
      icon.classList.remove("status-dot--loading");
    }

    async function loadAvailability() {
      systemOpen = false;
      consultButton.disabled = true;

      if (!client) {
        showConfigurationWarning(byId("config-alert"));
        updateAvailability("disabled", "Configuración pendiente", "El formulario se habilitará cuando el sistema sea conectado con la base de datos institucional.");
        return;
      }

      const { data, error } = await client.rpc("estado_sistema");
      if (error) {
        updateAvailability("error", "No se pudo verificar el horario", friendlyError(error, "Inténtelo nuevamente en unos minutos o comuníquese con el centro educativo."));
        return;
      }

      const state = data?.estado;
      if (state === "disponible") {
        systemOpen = true;
        consultButton.disabled = false;
        updateAvailability("open", "Sistema disponible", `Puede consultar su resultado hasta el ${formatCostaRicaDate(data.fin)}.`);
      } else if (state === "programado") {
        updateAvailability("closed", "Consulta aún no disponible", `Los resultados podrán consultarse a partir del ${formatCostaRicaDate(data.inicio)}.`);
      } else if (state === "cerrado") {
        updateAvailability("closed", "Periodo de consulta finalizado", `El horario de consulta finalizó el ${formatCostaRicaDate(data.fin)}. Comuníquese con el centro educativo si requiere orientación.`);
      } else {
        updateAvailability("disabled", "Publicación temporalmente deshabilitada", "El centro educativo informará por sus canales oficiales cuándo se habilitará la consulta.");
      }
    }

    function showResult(data) {
      const status = data.estado_admision;
      const messages = {
        "Admitido": {
          symbol: "✓",
          heading: "Admitido",
          text: "Nos complace comunicarle que fue admitido para cursar sétimo año. Felicitamos a la persona estudiante y a su familia por este logro. El centro educativo informará oportunamente los pasos siguientes."
        },
        "En lista de espera": {
          symbol: "…",
          heading: "En lista de espera",
          text: "Su solicitud permanece activa en la lista de espera. Esta condición puede cambiar si se liberan espacios. Le recomendamos mantenerse atento a los canales oficiales del centro educativo."
        },
        "No Admitido": {
          symbol: "i",
          heading: "No admitido en esta ocasión",
          text: "Agradecemos sinceramente el interés y el esfuerzo demostrado durante el proceso. En esta ocasión no fue posible asignarle un espacio. Este resultado no define sus capacidades ni su potencial académico."
        }
      };
      const selected = messages[status] || messages["No Admitido"];

      byId("result-symbol").textContent = selected.symbol;
      byId("student-name").textContent = data.nombre_completo || "Persona aspirante";
      byId("admission-status").textContent = selected.heading;
      byId("admission-message").textContent = selected.text;
      resultCard.dataset.result = status;
      resultPlaceholder.classList.add("d-none");
      resultContent.classList.remove("d-none");
      resultCard.focus({ preventScroll: true });
      resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function resetResult() {
      delete resultCard.dataset.result;
      resultContent.classList.add("d-none");
      resultPlaceholder.classList.remove("d-none");
      form.reset();
      form.classList.remove("was-validated");
      clearMessage(formMessage);
      byId("cedula").focus();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(formMessage);
      form.classList.add("was-validated");

      const id = normalizeId(byId("cedula").value);
      const password = byId("contrasena").value;
      const idValid = id.length >= 5 && id.length <= 20;
      const passwordValid = password.length >= 1 && password.length <= 72;
      byId("cedula").setCustomValidity(idValid ? "" : "invalid");
      byId("contrasena").setCustomValidity(passwordValid ? "" : "invalid");

      if (!form.checkValidity() || !systemOpen || !client) return;

      setBusy(consultButton, true, "Consultando…");
      const { data, error } = await client.rpc("consultar_resultado", {
        p_cedula: id,
        p_contrasena: password
      });
      byId("contrasena").value = "";
      setBusy(consultButton, false);
      consultButton.disabled = !systemOpen;

      if (error) {
        setMessage(formMessage, friendlyError(error, "No fue posible completar la consulta. Inténtelo nuevamente."));
        return;
      }

      if (data?.codigo === "ok") {
        showResult(data);
      } else if (data?.codigo === "bloqueado") {
        setMessage(formMessage, data.mensaje || "Se alcanzó el número máximo de intentos. Espere antes de volver a intentarlo.");
      } else if (data?.codigo === "no_disponible") {
        setMessage(formMessage, data.mensaje || "La consulta no está disponible en este momento.", "info");
        await loadAvailability();
      } else {
        setMessage(formMessage, "La cédula o la contraseña no coinciden con nuestros registros. Revise los datos e inténtelo nuevamente.");
      }
    });

    byId("new-query").addEventListener("click", resetResult);
    await loadAvailability();
  }

  async function initializeAdminPage() {
    const loginSection = byId("admin-login");
    const dashboard = byId("admin-dashboard");
    const loginForm = byId("admin-login-form");
    const loginButton = byId("admin-login-button");
    const loginMessage = byId("admin-login-message");
    const logoutButton = byId("logout-button");
    const pageSize = 25;
    let pageNumber = 0;
    let currentSearch = "";
    let currentRows = [];
    let importRows = [];
    let dashboardLoadedFor = null;

    if (!client) {
      showConfigurationWarning(byId("admin-config-alert"));
      loginForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
      return;
    }

    function showLogin() {
      loginSection.classList.remove("d-none");
      dashboard.classList.add("d-none");
      logoutButton.classList.add("d-none");
      byId("admin-email").classList.add("d-none");
      dashboardLoadedFor = null;
    }

    async function showDashboard(user) {
      if (dashboardLoadedFor === user.id) return;
      dashboardLoadedFor = user.id;
      loginSection.classList.add("d-none");
      dashboard.classList.remove("d-none");
      logoutButton.classList.remove("d-none");
      byId("admin-email").textContent = user.user_metadata?.usuario
        || user.email?.split("@")[0]
        || "Cuenta administrativa";
      byId("admin-email").classList.remove("d-none");

      const authorized = await loadSchedule(true);
      if (!authorized) {
        await client.auth.signOut();
        showLogin();
        setMessage(loginMessage, "La cuenta fue autenticada, pero no está registrada como administradora del sistema.");
        return;
      }
      await loadStudents();
    }

    async function checkSession() {
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) {
        showLogin();
        return;
      }
      await showDashboard(data.user);
    }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginForm.classList.add("was-validated");
      clearMessage(loginMessage);
      if (!loginForm.checkValidity()) return;

      setBusy(loginButton, true, "Ingresando…");
      const { data, error } = await client.auth.signInWithPassword({
        email: adminUsernameToEmail(byId("admin-username").value),
        password: byId("admin-password").value
      });
      byId("admin-password").value = "";
      setBusy(loginButton, false);

      if (error || !data?.user) {
        setMessage(loginMessage, "No fue posible iniciar sesión. Verifique el usuario y la contraseña.");
        return;
      }
      await showDashboard(data.user);
    });

    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      await client.auth.signOut();
      logoutButton.disabled = false;
      loginForm.reset();
      loginForm.classList.remove("was-validated");
      clearMessage(loginMessage);
      showLogin();
    });

    document.querySelectorAll(".dashboard-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".dashboard-tab").forEach((item) => {
          const selected = item === tab;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-selected", String(selected));
        });
        document.querySelectorAll(".dashboard-panel").forEach((panel) => {
          panel.classList.toggle("d-none", panel.id !== tab.dataset.panel);
        });
      });
    });

    async function loadStudents() {
      const tableMessage = byId("table-message");
      clearMessage(tableMessage);
      byId("students-body").replaceChildren();
      byId("empty-students").classList.add("d-none");
      byId("student-count").textContent = "Cargando registros…";

      const { data, error } = await client.rpc("admin_listar_estudiantes", {
        p_busqueda: currentSearch,
        p_limite: pageSize,
        p_desde: pageNumber * pageSize
      });

      if (error) {
        setMessage(tableMessage, friendlyError(error, "No fue posible cargar los registros."));
        byId("student-count").textContent = "Sin datos disponibles";
        return false;
      }

      currentRows = Array.isArray(data) ? data : [];
      const total = Number(currentRows[0]?.total_registros || 0);
      byId("student-count").textContent = `${total.toLocaleString("es-CR")} aspirante${total === 1 ? "" : "s"}`;
      byId("page-label").textContent = `Página ${pageNumber + 1} de ${Math.max(1, Math.ceil(total / pageSize))}`;
      byId("previous-page").disabled = pageNumber === 0;
      byId("next-page").disabled = (pageNumber + 1) * pageSize >= total;

      if (!currentRows.length) {
        byId("empty-students").classList.remove("d-none");
        return true;
      }

      const fragment = document.createDocumentFragment();
      currentRows.forEach((student) => {
        const row = document.createElement("tr");
        const idCell = document.createElement("td");
        const nameCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const actionCell = document.createElement("td");
        const badge = document.createElement("span");
        const actions = document.createElement("div");
        const editButton = document.createElement("button");
        const deleteButton = document.createElement("button");

        idCell.textContent = student.cedula;
        nameCell.textContent = [student.nombre, student.primer_apellido, student.segundo_apellido].filter(Boolean).join(" ");
        badge.textContent = student.estado_admision;
        badge.className = `status-badge ${statusClass(student.estado_admision)}`;
        statusCell.append(badge);

        actions.className = "table-actions";
        editButton.type = "button";
        editButton.className = "btn btn-outline-primary";
        editButton.textContent = "Editar";
        editButton.addEventListener("click", () => openStudentEditor(student));
        deleteButton.type = "button";
        deleteButton.className = "btn btn-outline-danger";
        deleteButton.textContent = "Eliminar";
        deleteButton.addEventListener("click", () => deleteStudent(student));
        actions.append(editButton, deleteButton);
        actionCell.className = "text-end";
        actionCell.append(actions);

        row.append(idCell, nameCell, statusCell, actionCell);
        fragment.append(row);
      });
      byId("students-body").append(fragment);
      return true;
    }

    function statusClass(status) {
      if (status === "Admitido") return "status-badge--admitted";
      if (status === "En lista de espera") return "status-badge--waiting";
      return "status-badge--not-admitted";
    }

    byId("search-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      currentSearch = byId("search-input").value.trim();
      pageNumber = 0;
      await loadStudents();
    });

    byId("clear-search").addEventListener("click", async () => {
      byId("search-input").value = "";
      currentSearch = "";
      pageNumber = 0;
      await loadStudents();
    });

    byId("previous-page").addEventListener("click", async () => {
      if (pageNumber > 0) pageNumber -= 1;
      await loadStudents();
    });

    byId("next-page").addEventListener("click", async () => {
      pageNumber += 1;
      await loadStudents();
    });

    function openStudentEditor(student = null) {
      const form = byId("student-editor-form");
      form.reset();
      form.classList.remove("was-validated");
      clearMessage(byId("editor-message"));
      byId("original-cedula").value = student?.cedula || "";
      byId("edit-cedula").value = student?.cedula || "";
      byId("edit-name").value = student?.nombre || "";
      byId("edit-first-name").value = student?.primer_apellido || "";
      byId("edit-second-name").value = student?.segundo_apellido || "";
      byId("edit-status").value = student?.estado_admision || "Admitido";
      byId("student-dialog-title").textContent = student ? "Editar aspirante" : "Agregar aspirante";
      byId("password-edit-help").textContent = student
        ? "Déjela vacía para conservar la contraseña actual."
        : "Requerida para un registro nuevo; mínimo 6 caracteres.";
      byId("edit-password").required = !student;
      byId("student-dialog").showModal();
      byId("edit-cedula").focus();
    }

    byId("add-student-button").addEventListener("click", () => openStudentEditor());

    byId("student-editor-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      form.classList.add("was-validated");
      clearMessage(byId("editor-message"));
      if (!form.checkValidity()) return;

      const password = byId("edit-password").value;
      if (password && password.length < 6) {
        setMessage(byId("editor-message"), "La contraseña debe tener al menos 6 caracteres.");
        return;
      }

      const saveButton = byId("save-student");
      saveButton.disabled = true;
      const { data, error } = await client.rpc("admin_guardar_estudiante", {
        p_cedula_original: byId("original-cedula").value || null,
        p_cedula: byId("edit-cedula").value,
        p_contrasena: password || null,
        p_nombre: byId("edit-name").value,
        p_primer_apellido: byId("edit-first-name").value,
        p_segundo_apellido: byId("edit-second-name").value,
        p_estado_admision: byId("edit-status").value
      });
      saveButton.disabled = false;

      if (error || data?.codigo !== "ok") {
        setMessage(byId("editor-message"), data?.mensaje || friendlyError(error, "No fue posible guardar el registro."));
        return;
      }

      byId("student-dialog").close();
      pageNumber = 0;
      await loadStudents();
      setMessage(byId("table-message"), "El registro se guardó correctamente.", "success");
    });

    async function deleteStudent(student) {
      const fullName = [student.nombre, student.primer_apellido, student.segundo_apellido].filter(Boolean).join(" ");
      if (!window.confirm(`¿Desea eliminar el registro de ${fullName} (${student.cedula})?`)) return;

      const { data, error } = await client.rpc("admin_eliminar_estudiante", { p_cedula: student.cedula });
      if (error || data?.codigo !== "ok") {
        setMessage(byId("table-message"), data?.mensaje || friendlyError(error, "No fue posible eliminar el registro."));
        return;
      }
      await loadStudents();
      setMessage(byId("table-message"), "El registro fue eliminado.", "success");
    }

    async function loadSchedule(silent = false) {
      if (!silent) clearMessage(byId("schedule-message"));
      const { data, error } = await client.rpc("admin_obtener_configuracion");
      if (error || !data) {
        if (!silent) setMessage(byId("schedule-message"), friendlyError(error, "No fue posible cargar el horario."));
        return false;
      }

      byId("start-date").value = toCostaRicaInput(data.inicio);
      byId("end-date").value = toCostaRicaInput(data.fin);
      byId("system-enabled").checked = Boolean(data.habilitado);
      const statusText = data.estado === "disponible"
        ? "Consulta pública disponible"
        : data.estado === "programado"
          ? "Publicación programada"
          : data.estado === "cerrado"
            ? "Periodo finalizado"
            : "Publicación deshabilitada";
      byId("system-summary").textContent = statusText;
      return true;
    }

    byId("schedule-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage(byId("schedule-message"));
      const start = fromCostaRicaInput(byId("start-date").value);
      const end = fromCostaRicaInput(byId("end-date").value);
      if (!start || !end || new Date(end) <= new Date(start)) {
        setMessage(byId("schedule-message"), "La fecha de cierre debe ser posterior a la fecha de inicio.");
        return;
      }

      const button = byId("save-schedule");
      button.disabled = true;
      const { data, error } = await client.rpc("admin_guardar_configuracion", {
        p_inicio: start,
        p_fin: end,
        p_habilitado: byId("system-enabled").checked
      });
      button.disabled = false;
      if (error || data?.codigo !== "ok") {
        setMessage(byId("schedule-message"), data?.mensaje || friendlyError(error, "No fue posible guardar el horario."));
        return;
      }
      await loadSchedule();
      setMessage(byId("schedule-message"), "El horario se guardó correctamente.", "success");
    });

    function normalizeHeader(value) {
      return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    }

    function normalizeAdmissionStatus(value) {
      const normalized = String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
      if (["admitido", "si", "sí", "true", "1"].includes(normalized)) return "Admitido";
      if (["no admitido", "no", "false", "0"].includes(normalized)) return "No Admitido";
      if (["en lista de espera", "lista de espera", "espera"].includes(normalized)) return "En lista de espera";
      return null;
    }

    function readSpreadsheet(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("No fue posible leer el archivo."));
        reader.onload = () => {
          try {
            const workbook = window.XLSX.read(reader.result, {
              type: "array",
              cellFormula: false,
              cellHTML: false,
              cellText: true,
              dense: true
            });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const matrix = window.XLSX.utils.sheet_to_json(sheet, {
              header: 1,
              defval: "",
              raw: false,
              blankrows: false
            });
            resolve(matrix);
          } catch (error) {
            reject(error);
          }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    byId("import-file").addEventListener("change", async (event) => {
      importRows = [];
      byId("import-preview").classList.add("d-none");
      clearMessage(byId("import-message"));
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        setMessage(byId("import-message"), "El archivo supera el límite de 5 MB.");
        event.target.value = "";
        return;
      }

      try {
        if (!window.XLSX) throw new Error("No fue posible cargar el lector de Excel. Revise la conexión e inténtelo nuevamente.");
        const matrix = await readSpreadsheet(file);
        if (matrix.length < 2 || matrix.length > 5001) throw new Error("El archivo debe contener entre 1 y 5 000 registros.");
        const headers = matrix[0].map(normalizeHeader);
        const required = ["cedula", "contrasena", "nombre", "primer_apellido", "segundo_apellido", "estado_admision"];
        const missing = required.filter((header) => !headers.includes(header));
        if (missing.length) throw new Error(`Faltan columnas requeridas: ${missing.join(", ")}.`);

        const indexes = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
        const errors = [];
        const seen = new Set();
        matrix.slice(1).forEach((cells, offset) => {
          if (cells.every((cell) => String(cell).trim() === "")) return;
          const rowNumber = offset + 2;
          const id = normalizeId(cells[indexes.cedula]);
          const password = String(cells[indexes.contrasena] ?? "").trim();
          const name = String(cells[indexes.nombre] ?? "").trim();
          const firstName = String(cells[indexes.primer_apellido] ?? "").trim();
          const secondName = String(cells[indexes.segundo_apellido] ?? "").trim();
          const status = normalizeAdmissionStatus(cells[indexes.estado_admision]);

          if (id.length < 5 || id.length > 20) errors.push(`Fila ${rowNumber}: cédula no válida.`);
          if (seen.has(id)) errors.push(`Fila ${rowNumber}: cédula duplicada dentro del archivo.`);
          if (password.length < 6 || password.length > 72) errors.push(`Fila ${rowNumber}: la contraseña debe contener de 6 a 72 caracteres.`);
          if (!name || !firstName) errors.push(`Fila ${rowNumber}: nombre y primer apellido son requeridos.`);
          if (!status) errors.push(`Fila ${rowNumber}: estado de admisión no reconocido.`);
          seen.add(id);
          importRows.push({
            cedula: id,
            contrasena: password,
            nombre: name,
            primer_apellido: firstName,
            segundo_apellido: secondName,
            estado_admision: status
          });
        });

        if (!importRows.length) throw new Error("El archivo no contiene registros para importar.");
        if (errors.length) {
          importRows = [];
          const excerpt = errors.slice(0, 8).join(" ");
          throw new Error(`${excerpt}${errors.length > 8 ? ` Se encontraron ${errors.length} errores en total.` : ""}`);
        }

        byId("import-summary").textContent = `${importRows.length.toLocaleString("es-CR")} registros listos para importar. Se muestran los primeros cinco.`;
        const previewBody = byId("import-preview-body");
        previewBody.replaceChildren();
        importRows.slice(0, 5).forEach((rowData) => {
          const row = document.createElement("tr");
          [rowData.cedula, `${rowData.nombre} ${rowData.primer_apellido} ${rowData.segundo_apellido}`.trim(), rowData.estado_admision]
            .forEach((value) => {
              const cell = document.createElement("td");
              cell.textContent = value;
              row.append(cell);
            });
          previewBody.append(row);
        });
        byId("import-preview").classList.remove("d-none");
      } catch (error) {
        importRows = [];
        setMessage(byId("import-message"), error.message || "El archivo no tiene un formato válido.");
      }
    });

    byId("import-button").addEventListener("click", async () => {
      if (!importRows.length) return;
      const button = byId("import-button");
      button.disabled = true;
      clearMessage(byId("import-message"));
      let processed = 0;

      for (let index = 0; index < importRows.length; index += 100) {
        const chunk = importRows.slice(index, index + 100);
        const { data, error } = await client.rpc("admin_importar_estudiantes", { p_registros: chunk });
        if (error || data?.codigo !== "ok") {
          button.disabled = false;
          setMessage(byId("import-message"), data?.mensaje || friendlyError(error, `La importación se detuvo después de ${processed} registros.`));
          return;
        }
        processed += Number(data.procesados || chunk.length);
        button.textContent = `Importando ${processed} de ${importRows.length}…`;
      }

      button.disabled = false;
      button.textContent = "Importar y actualizar coincidencias";
      setMessage(byId("import-message"), `Se importaron correctamente ${processed.toLocaleString("es-CR")} registros.`, "success");
      importRows = [];
      byId("import-file").value = "";
      byId("import-preview").classList.add("d-none");
      pageNumber = 0;
      await loadStudents();
    });

    byId("open-purge-dialog").addEventListener("click", () => {
      byId("purge-confirmation").value = "";
      byId("purge-button").disabled = true;
      clearMessage(byId("purge-message"));
      byId("purge-dialog").showModal();
      byId("purge-confirmation").focus();
    });

    byId("purge-confirmation").addEventListener("input", (event) => {
      byId("purge-button").disabled = event.target.value !== "ELIMINAR TODO";
    });

    byId("purge-button").addEventListener("click", async () => {
      const button = byId("purge-button");
      button.disabled = true;
      const { data, error } = await client.rpc("admin_vaciar_estudiantes", {
        p_confirmacion: byId("purge-confirmation").value
      });
      if (error || data?.codigo !== "ok") {
        setMessage(byId("purge-message"), data?.mensaje || friendlyError(error, "No fue posible vaciar la base de datos."));
        button.disabled = false;
        return;
      }
      byId("purge-dialog").close();
      pageNumber = 0;
      await loadStudents();
      setMessage(byId("table-message"), `Se eliminaron ${Number(data.eliminados || 0).toLocaleString("es-CR")} registros.`, "success");
      document.querySelector('[data-panel="students-panel"]').click();
    });

    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => byId(button.dataset.closeDialog)?.close());
    });

    await checkSession();
  }

  setupPasswordToggles();
  if (page === "consulta") initializeStudentPage();
  if (page === "admin") initializeAdminPage();
})();
