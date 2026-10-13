## Qué cambia

<!-- Una o dos frases. Módulo afectado: ventas, inventario, compras, CxC, CxP, caja, contabilidad, e-CF... -->

## Reglas del proyecto

- [ ] `npm test` en verde (incluye las invariantes contables)
- [ ] El renderer no toca SQLite; todo pasa por IPC con permiso verificado en `main`
- [ ] Tablas con UUID, `created_at`/`updated_at`/`deleted_at`; sin `DELETE` físico
- [ ] ITBIS incluido en el precio; anular es revertir
- [ ] Migración idempotente, probada sobre una copia de una base existente (si aplica)
- [ ] Sin dependencias de red nuevas (salvo el cliente e-CF de la DGII)

## Cómo se probó
