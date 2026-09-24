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
    await window.puntoXAuth.login({
      usuario: document.getElementById('login-usuario').value.trim(),
      password: document.getElementById('login-password').value,
    });
    window.location.href = '../dashboard/index.html';
  } catch (err) {
    mostrarError(err.message);
    boton.disabled = false;
    boton.textContent = 'Iniciar sesión';
  }
});

cargarMarca();
