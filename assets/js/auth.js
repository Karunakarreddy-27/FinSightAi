document.addEventListener('DOMContentLoaded', () => {
    const loginView = document.getElementById('login-view');
    const signupView = document.getElementById('signup-view');
    const roleSelectionView = document.getElementById('role-selection-view');
    const roleWelcomeHeading = roleSelectionView?.querySelector('h5');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const loginError = document.getElementById('login-error');
    const signupError = document.getElementById('signup-error');
    const businessSetupView = document.getElementById('business-setup-view');
    const businessSetupForm = document.getElementById('business-setup-form');
    const businessSetupError = document.getElementById('business-setup-error');

    const showError = (element, message) => {
        element.textContent = message;
        element.classList.remove('d-none');
    };

    const clearError = (element) => {
        element.textContent = '';
        element.classList.add('d-none');
    };

    const readApiResponse = async (response) => {
        const body = await response.text();
        let result;
        try {
            result = body ? JSON.parse(body) : null;
        } catch {
            result = null;
        }

        if (!result || typeof result !== 'object') {
            const detail = body.trim().slice(0, 160);
            const message = detail
                ? `The server returned an unexpected response (HTTP ${response.status}). ${detail}`
                : `The server returned an empty response (HTTP ${response.status}). Check that the backend is running.`;
            throw new Error(message);
        }

        if (!response.ok) {
            throw new Error(result.message || `Request failed (HTTP ${response.status}). Please try again.`);
        }
        return result;
    };

    const sendAuthRequest = async (endpoint, payload) => {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        return readApiResponse(response);
    };

    const sendApiRequest = async (endpoint, method = 'GET', payload = null) => {
        const options = { method, credentials: 'same-origin', headers: {} };
        if (payload !== null) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(payload);
        }
        const response = await fetch(endpoint, options);
        const result = await readApiResponse(response);
        return result.data;
    };

    const setLoading = (button, loading, label) => {
        button.disabled = loading;
        button.innerHTML = loading
            ? `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${label}`
            : button.dataset.originalLabel;
    };

    document.getElementById('show-signup')?.addEventListener('click', (event) => {
        event.preventDefault();
        clearError(loginError);
        loginView.classList.add('d-none');
        signupView.classList.remove('d-none');
    });

    document.getElementById('show-login')?.addEventListener('click', (event) => {
        event.preventDefault();
        clearError(signupError);
        signupView.classList.add('d-none');
        loginView.classList.remove('d-none');
    });

    loginForm?.querySelector('button[type="submit"]') &&
        (loginForm.querySelector('button[type="submit"]').dataset.originalLabel = loginForm.querySelector('button[type="submit"]').innerHTML);
    signupForm?.querySelector('button[type="submit"]') &&
        (signupForm.querySelector('button[type="submit"]').dataset.originalLabel = signupForm.querySelector('button[type="submit"]').innerHTML);

    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearError(loginError);
        const button = loginForm.querySelector('button[type="submit"]');
        setLoading(button, true, 'Authenticating...');
        try {
            await sendAuthRequest('/api/auth/login', {
                email: loginForm.querySelector('input[type="email"]').value,
                password: loginForm.querySelector('input[type="password"]').value,
                remember: document.getElementById('rememberMe').checked
            });
            if (roleWelcomeHeading) roleWelcomeHeading.textContent = 'Welcome Back!';
            loginView.classList.add('d-none');
            roleSelectionView.classList.remove('d-none');
        } catch (error) {
            showError(loginError, error.message);
        } finally {
            setLoading(button, false);
        }
    });

    signupForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearError(signupError);
        const button = signupForm.querySelector('button[type="submit"]');
        setLoading(button, true, 'Creating account...');
        try {
            const newUser = await sendAuthRequest('/api/auth/signup', {
                name: signupForm.querySelector('input[type="text"]').value,
                email: signupForm.querySelector('input[type="email"]').value,
                password: signupForm.querySelector('input[type="password"]').value
            });
            if (roleWelcomeHeading) {
                roleWelcomeHeading.textContent = newUser.data?.name
                    ? `Welcome, ${newUser.data.name}!`
                    : 'Welcome!';
            }
            signupView.classList.add('d-none');
            roleSelectionView.classList.remove('d-none');
        } catch (error) {
            showError(signupError, error.message);
        } finally {
            setLoading(button, false);
        }
    });

    businessSetupForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        clearError(businessSetupError);
        const button = businessSetupForm.querySelector('button[type="submit"]');
        const label = button.textContent;
        button.disabled = true;
        button.textContent = 'Saving business...';
        try {
            await sendApiRequest('/api/business/profile', 'POST', {
                business_name: document.getElementById('business-name').value.trim(),
                business_category: document.getElementById('business-category').value
            });
            window.location.href = 'dashboard.html';
        } catch (error) {
            showError(businessSetupError, error.message);
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    });

    document.getElementById('btn-business-mode')?.addEventListener('click', async (event) => {
        event.preventDefault();
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const profile = await sendApiRequest('/api/business/profile');
            if (profile.business_name && profile.business_category) {
                window.location.href = 'dashboard.html';
                return;
            }
            document.getElementById('business-name').value = profile.business_name || '';
            document.getElementById('business-category').value = profile.business_category || '';
            roleSelectionView.classList.add('d-none');
            businessSetupView.classList.remove('d-none');
        } catch (error) {
            alert(error.message);
        } finally {
            button.disabled = false;
        }
    });

    document.getElementById('btn-personal-mode')?.addEventListener('click', (event) => {
        event.preventDefault();
        alert('Personal mode is unavailable. Please select Business Intelligence.');
    });
});
