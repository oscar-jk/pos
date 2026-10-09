async function cargarMarca() {
  try {
    const info = await window.puntoX.getAppInfo();
    if (info.negocio && info.negocio.nombre) document.getElementById('login-nombre-negocio').textContent = info.negocio.nombre;
    if (info.negocio && info.negocio.iniciales) document.getElementById('login-badge').textContent = info.negocio.iniciales;
  } catch (err) {
    // Si esto falla, el login sigue funcionando con la marca por defecto.
  }
}

function mostrarError(msg) {
  const el = document.getElementById('login-error');
  if (!msg) { el.style.display = 'none'; return; }
  el.textContent = msg.replace(/^Error invoking remote method '.*?': Error: /, '');
  el.style.display = 'block';
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  mostrarError(null);
  const boton = document.getElementById('login-btn');
  boton.disabled = true;
  boton.textContent = 'Ingresando...';

  try {
    const sesion = await window.puntoXAuth.login({
      usuario: document.getElementById('login-usuario').value.trim(),
      password: document.getElementById('login-password').value,
    });
    if (sesion && sesion.debeCambiarPassword) {
      mostrarCambio(document.getElementById('login-password').value);
      return;
    }
    window.location.href = '../dashboard/index.html';
  } catch (err) {
    mostrarError(err.message);
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});

// --- Cambio obligatorio de contraseña (contraseña de fábrica o puesta por el administrador) ---

function mostrarCambio(actual) {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('cambio-form').style.display = 'block';
  document.querySelector('.login-card__subtitulo').textContent = 'Cambia tu contraseña';
  const campoActual = document.getElementById('cambio-actual');
  campoActual.value = actual || '';
  (actual ? document.getElementById('cambio-nueva') : campoActual).focus();
}

document.getElementById('cambio-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  mostrarError(null);
  const nueva = document.getElementById('cambio-nueva').value;
  if (nueva !== document.getElementById('cambio-repetir').value) { mostrarError('Las dos contraseñas nuevas no coinciden'); return; }
  const boton = document.getElementById('cambio-btn');
  boton.disabled = true;
  try {
    await window.puntoXAuth.cambiarPassword({ actual: document.getElementById('cambio-actual').value, nueva });
    window.location.href = '../dashboard/index.html';
  } catch (err) {
    mostrarError(err.message);
    boton.disabled = false;
  }
});

document.getElementById('cambio-salir').addEventListener('click', async () => {
  await window.puntoXAuth.logout();
  window.location.hash = '';
  window.location.reload();
});

async function revisarCambioPendiente() {
  if (!window.puntoXAuth.sesionActual) return;
  const sesion = await window.puntoXAuth.sesionActual();
  if (sesion && sesion.debeCambiarPassword) mostrarCambio('');
}

cargarMarca();
revisarCambioPendiente();
