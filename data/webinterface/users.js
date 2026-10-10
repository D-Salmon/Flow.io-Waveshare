(function (global) {
  'use strict';
  var pages = global.FlowWebPages = global.FlowWebPages || {};
  function create({ bindClickAction, extractApiErrorMessage, fetchWithBusyRetry, normalizeRole, roleLabel, tr }) {
    // ---- Users management ----
    let userFormEditingUsername = '';

    function usersFormBody(data) {
      const body = new URLSearchParams();
      Object.keys(data).forEach((k) => {
        if (data[k] !== undefined && data[k] !== null) body.set(k, data[k]);
      });
      return body;
    }

    function usersListEl() { return document.getElementById('usersList'); }
    function usersListStatusEl() { return document.getElementById('usersListStatus'); }
    function userFormCardEl() { return document.getElementById('userFormCard'); }
    function userFormTitleEl() { return document.getElementById('userFormTitle'); }
    function userUsernameEl() { return document.getElementById('userUsername'); }
    function userPasswordEl() { return document.getElementById('userPassword'); }
    function userRoleSelectEl() { return document.getElementById('userRoleSelect'); }
    function userFormStatusEl() { return document.getElementById('userFormStatus'); }
    function ownPasswordEl() { return document.getElementById('ownPassword'); }
    function ownPasswordStatusEl() { return document.getElementById('ownPasswordStatus'); }

    async function refreshUsersList() {
      const list = usersListEl();
      const status = usersListStatusEl();
      if (!list) return;
      try {
        const res = await fetchWithBusyRetry('/api/auth/users', { cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) {
          if (status) status.textContent = extractApiErrorMessage(data, tr('users.status.error', 'Erreur'));
          if (list) list.innerHTML = '';
          return;
        }
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        if (status) status.textContent = '';
        if (list) {
          if (accounts.length === 0) {
            list.innerHTML = '<div class="users-empty">' + tr('users.empty', 'Aucun compte enregistré.') + '</div>';
          } else {
            list.innerHTML = '';
            const administratorCount = accounts.filter(account => normalizeRole(account.role) === 'admin').length;
            accounts.forEach((account) => list.appendChild(buildUsersRow(account, administratorCount)));
          }
        }
      } catch (err) {
        if (status) status.textContent = tr('users.status.error', 'Erreur');
      }
    }

    function buildUsersRow(account, administratorCount) {
      const row = document.createElement('div');
      row.className = 'users-row';

      const avatar = document.createElement('span');
      avatar.className = 'users-avatar';
      avatar.textContent = account.username ? String(Array.from(String(account.username))[0]).toUpperCase() : '?';

      const copy = document.createElement('div');
      copy.className = 'users-copy';
      const uname = document.createElement('div');
      uname.className = 'users-username';
      uname.textContent = account.username;
      const roleNode = document.createElement('div');
      roleNode.className = 'users-role';
      const roleValue = normalizeRole(account.role);
      const badge = document.createElement('span');
      badge.className = 'role-badge' + (roleValue === 'admin' ? ' admin' : '');
      badge.textContent = roleLabel(roleValue);
      roleNode.appendChild(badge);
      copy.appendChild(uname);
      copy.appendChild(roleNode);

      const actions = document.createElement('div');
      actions.className = 'users-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-tonal';
      editBtn.textContent = tr('users.actions.edit', 'Modifier');
      editBtn.addEventListener('click', () => openUserForm(account.username, roleValue));
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-tonal danger-action';
      delBtn.textContent = tr('users.actions.delete', 'Supprimer');
      delBtn.addEventListener('click', () => deleteUser(account.username));
      actions.appendChild(editBtn);
      if (roleValue !== 'admin' || administratorCount > 1) actions.appendChild(delBtn);

      row.appendChild(avatar);
      row.appendChild(copy);
      row.appendChild(actions);
      return row;
    }

    function openUserForm(username, roleValue) {
      const card = userFormCardEl();
      if (!card) return;
      userFormEditingUsername = username || '';
      if (userFormTitleEl()) {
        userFormTitleEl().textContent = userFormEditingUsername
          ? tr('users.form.edit', 'Modifier le compte')
          : tr('users.form.add', 'Ajouter un compte');
      }
      if (userUsernameEl()) {
        userUsernameEl().value = userFormEditingUsername;
        userUsernameEl().disabled = !!userFormEditingUsername;
      }
      if (userPasswordEl()) userPasswordEl().value = '';
      if (userRoleSelectEl()) userRoleSelectEl().value = roleValue || 'operator';
      if (userFormStatusEl()) userFormStatusEl().textContent = '';
      card.hidden = false;
    }

    function closeUserForm() {
      userFormEditingUsername = '';
      const card = userFormCardEl();
      if (card) card.hidden = true;
    }

    async function saveUser() {
      const username = userUsernameEl() ? String(userUsernameEl().value || '').trim() : '';
      const password = userPasswordEl() ? String(userPasswordEl().value || '') : '';
      const role = userRoleSelectEl() ? userRoleSelectEl().value : 'operator';
      const status = userFormStatusEl();
      if (!username) {
        if (status) status.textContent = tr('users.form.username', 'Identifiant');
        return;
      }
      const body = usersFormBody({ username: username, password: password, role: role });
      let res;
      try {
        res = await fetchWithBusyRetry('/api/auth/users', { method: 'POST', body: body, cache: 'no-store' });
      } catch (err) {
        if (status) status.textContent = tr('users.status.error', 'Erreur');
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok === true) {
        if (status) status.textContent = tr('users.status.saved', 'Compte enregistré.');
        closeUserForm();
        refreshUsersList();
      } else if (status) {
        status.textContent = extractApiErrorMessage(data, tr('users.status.error', 'Erreur'));
      }
    }

    async function deleteUser(username) {
      const label = tr('users.confirmDelete', 'Supprimer le compte ?').replace('{username}', username);
      if (!window.confirm(label)) return;
      const body = usersFormBody({ username: username });
      try {
        const res = await fetchWithBusyRetry('/api/auth/users/delete', { method: 'POST', body: body, cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok === true) {
          refreshUsersList();
        } else {
          const status = usersListStatusEl();
          if (status) status.textContent = extractApiErrorMessage(data, tr('users.status.error', 'Erreur'));
        }
      } catch (err) {
        const status = usersListStatusEl();
        if (status) status.textContent = tr('users.status.error', 'Erreur');
      }
    }

    async function changeOwnPassword() {
      const password = ownPasswordEl() ? String(ownPasswordEl().value || '') : '';
      const status = ownPasswordStatusEl();
      if (!password) return;
      const body = usersFormBody({ password: password });
      try {
        const res = await fetchWithBusyRetry('/api/auth/password', { method: 'POST', body: body, cache: 'no-store' });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok === true) {
          if (status) status.textContent = tr('users.status.passwordChanged', 'Mot de passe mis à jour.');
          if (ownPasswordEl()) ownPasswordEl().value = '';
        } else if (status) {
          status.textContent = extractApiErrorMessage(data, tr('users.status.error', 'Erreur'));
        }
      } catch (err) {
        if (status) status.textContent = tr('users.status.error', 'Erreur');
      }
    }

    function openAccountDialog() {
      const dialog = document.getElementById('accountDialog');
      if (!dialog) return;
      if (ownPasswordEl()) ownPasswordEl().value = '';
      if (ownPasswordStatusEl()) ownPasswordStatusEl().textContent = '';
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', 'open');
      }
    }

    function closeAccountDialog() {
      const dialog = document.getElementById('accountDialog');
      if (!dialog) return;
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }

    function initUsersBindings() {
      bindClickAction(document.getElementById('usersAddBtn'), () => openUserForm('', 'operator'));
      bindClickAction(document.getElementById('userCancelBtn'), closeUserForm);
      bindClickAction(document.getElementById('userSaveBtn'), saveUser);
      bindClickAction(document.getElementById('ownPasswordBtn'), changeOwnPassword);
      bindClickAction(document.getElementById('accountDialogClose'), closeAccountDialog);
    }


    initUsersBindings();
    return { refresh: refreshUsersList, openAccount: openAccountDialog };
  }
  pages.users = { create: create };
})(window);
