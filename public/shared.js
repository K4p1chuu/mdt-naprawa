// ================================================================
// POMOCNICZE FUNKCJE AUTORYZACJI
// ================================================================

function getAuthToken() {
    // Sprawdza obie możliwe nazwy tokenu, aby uniknąć błędów
    return localStorage.getItem('mdt-token') || localStorage.getItem('token');
}

function clearAuthSession() {
    localStorage.removeItem('mdt-token');
    localStorage.removeItem('token');
    localStorage.removeItem('system');  // DODANO: Usuwanie systemu
    localStorage.removeItem('userData');
    sessionStorage.clear();
}

// ================================================================
// 1. SZYBKIE SPRAWDZENIE AUTORYZACJI (IIFE)
// ================================================================
(function() {
    const token = getAuthToken();
    const path = window.location.pathname;

    // Lista stron, na których NIE wymagamy tokenu (strony logowania)
    const publicPages = [
        '/', 
        '/index.html', 
        'index.html',
        '/cepik-login.html', 
        'cepik-login.html',
        '/login.html'
    ];

    // Sprawdzamy, czy obecna strona jest na liście publicznych
    const isPublicPage = publicPages.some(page => path.endsWith(page));

    // Jeśli nie ma tokenu i nie jesteśmy na stronie logowania -> Wyrzuć
    if (!token && !isPublicPage) {
        console.warn('Brak tokenu autoryzacji. Przekierowanie do logowania.');
        window.location.href = 'index.html';
    }
})();

// ================================================================
// 2. FUNKCJA SPRAWDZANIA AUTORYZACJI (dla stron bez sidebara)
// ================================================================

async function checkAuth(requiredSystem = null) {
    const token = getAuthToken();
    const system = localStorage.getItem('system');
    
    if (!token) {
        console.log('Brak tokenu, przekierowanie do logowania');
        window.location.href = 'index.html';
        return null;
    }

    try {
        const response = await fetch('/api/verify', {
            method: 'GET',
            headers: { 'Authorization': token }
        });

        if (!response.ok) {
            console.log('Token nieważny, przekierowanie do logowania');
            clearAuthSession();
            window.location.href = 'index.html';
            return null;
        }

        const userData = await response.json();
        
        // Sprawdź czy użytkownik ma dostęp do wymaganego systemu
        if (requiredSystem && system !== requiredSystem) {
            console.log(`Brak dostępu do systemu ${requiredSystem}, aktualny system: ${system}`);
            window.location.href = 'index.html';
            return null;
        }

        return { ...userData, system };
    } catch (error) {
        console.error('Błąd weryfikacji tokenu:', error);
        clearAuthSession();
        window.location.href = 'index.html';
        return null;
    }
}

// ================================================================
// 3. ŁADOWANIE SIDEBARA I DANYCH UŻYTKOWNIKA (dla stron policyjnych)
// ================================================================

async function loadSidebarAndUserData(activePage, requiredSystem = null) {
    const token = getAuthToken();
    const system = localStorage.getItem('system');
    
    // Dodatkowe zabezpieczenie wewnątrz funkcji asynchronicznej
    if (!token) {
        window.location.href = 'index.html';
        return null;
    }

    try {
        const response = await fetch('/api/verify', {
            headers: { 'Authorization': token }
        });

        if (!response.ok) {
            console.error('Błąd weryfikacji tokenu przez API.');
            clearAuthSession();
            window.location.href = 'index.html';
            throw new Error('Sesja wygasła lub jest nieprawidłowa');
        }

        const userData = await response.json();
        
        // DODANO: Sprawdź czy użytkownik ma dostęp do wymaganego systemu
        if (requiredSystem && system !== requiredSystem) {
            console.log(`Brak dostępu do systemu ${requiredSystem}, aktualny system: ${system}`);
            clearAuthSession();
            window.location.href = 'index.html';
            return null;
        }
        
        // Zapiszmy poprawne dane w localStorage dla innych skryptów
        localStorage.setItem('userData', JSON.stringify(userData));

        const sidebarContainer = document.getElementById('sidebar-container');
        
        // === LOGIKA DLA UERD (MEDYCY / STRAŻ) ===
        if (userData.department === 'UERD') {
            if (sidebarContainer) {
                sidebarContainer.innerHTML = `
                    <div class="flex items-center mb-6 justify-center border-b border-gray-700 pb-4">
                         <h1 class="text-2xl font-bold text-red-500 tracking-wider">UERD</h1>
                    </div>
                    <nav class="flex-grow space-y-2">
                        <a href="uerd.html" class="sidebar-link flex items-center px-3 py-2 rounded-lg text-white bg-red-700 hover:bg-red-600 transition-colors">
                            <i data-lucide="activity" class="w-5 h-5 mr-3"></i> Powrót do Panelu UERD
                        </a>
                        <div class="p-4 text-sm text-gray-400 text-center">
                            Jesteś w trybie podglądu systemu.<br>Wróć do głównego panelu, aby zarządzać interwencjami.
                        </div>
                    </nav>
                    <div class="mt-auto">
                        <div class="border-t border-gray-700 pt-4">
                            <p class="text-sm font-semibold text-white">${userData.username}</p>
                            <p class="text-xs text-red-400">[${userData.badge}] - ${userData.rank}</p>
                        </div>
                        <a href="#" id="logout-button" class="sidebar-link flex items-center mt-2 px-4 py-3 rounded-lg text-gray-400 hover:bg-red-900 hover:text-white">
                            <i data-lucide="log-out" class="w-5 h-5 mr-3"></i> Wyloguj się
                        </a>
                    </div>
                `;
                lucide.createIcons();
                document.getElementById('logout-button').addEventListener('click', (e) => {
                    e.preventDefault();
                    clearAuthSession();
                    window.location.href = 'index.html';
                });
            }
            return userData;
        }

        // === LOGIKA DLA POLICJI (STANDARDOWA) ===
        // Generowanie standardowego menu (tylko jeśli kontener istnieje)
        if (sidebarContainer) {
            const sidebarHTML = `
                <div class="flex items-center mb-6">
                     <a href="dashboard.html" class="flex items-center space-x-2">
                        <img src="ocsowsp.png" alt="Logo" class="h-10 w-auto" onerror="this.style.display='none'">
                     </a>
                </div>
                <nav class="flex-grow space-y-2">
                    <div>
                        <button data-category="glowne" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>GŁÓWNE</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-glowne" class="category-content mt-1 space-y-1 pl-4">
                            <a href="dashboard.html" class="sidebar-link ${activePage === 'dashboard' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="layout-dashboard" class="w-5 h-5 mr-3"></i> Panel Główny</a>
                            ${(userData.badge === '00' || userData.badge === '101' || userData.rank === 'Chief Of the Police' || userData.rank === 'Superintendent') ? `
                            <a href="audit-logs.html" class="sidebar-link ${activePage === 'audit-logs' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="file-text" class="w-5 h-5 mr-3"></i> Logi Akcji</a>
                            ` : ''}
                        </div>
                    </div>
                    <div>
                        <button data-category="bazy" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>BAZY DANYCH</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-bazy" class="category-content mt-1 space-y-1 pl-4">
                             <a href="database.html" class="sidebar-link ${activePage === 'database' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="database" class="w-5 h-5 mr-3"></i> Baza Obywateli</a>
                             <a href="vehicle-database.html" class="sidebar-link ${activePage === 'vehicle-database' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="car" class="w-5 h-5 mr-3"></i> Baza Pojazdów</a>
                             <a href="parking.html" class="sidebar-link ${activePage === 'parking' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="parking-circle" class="w-5 h-5 mr-3"></i> Parking Policyjny</a>
                             <a href="suspended-licenses.html" class="sidebar-link ${activePage === 'suspended-licenses' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="file-minus-2" class="w-5 h-5 mr-3"></i> Wstrzymane Prawa Jazdy</a>
                        </div>
                    </div>
                    <div>
                        <button data-category="operacje" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>OPERACJE</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-operacje" class="category-content mt-1 space-y-1 pl-4">
                             <a href="ticket-form.html" class="sidebar-link ${activePage === 'ticket' || activePage === 'ticket-form' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="file-text" class="w-5 h-5 mr-3"></i> Wystaw Mandat</a>
                             <a href="arrest-form.html" class="sidebar-link ${activePage === 'arrest' || activePage === 'arrest-form' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="shield-alert" class="w-5 h-5 mr-3"></i> Aresztowanie</a>
                             <a href="vehicle-database.html" class="sidebar-link ${activePage === 'vehicle-search' || activePage === 'vehicle-database' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="database" class="w-5 h-5 mr-3"></i> Baza Pojazdów</a>
                        </div>
                    </div>
                    <div>
                        <button data-category="alertyBolo" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>ALERTY</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-alertyBolo" class="category-content mt-1 space-y-1 pl-4">
                             <a href="bolo.html" class="sidebar-link ${activePage === 'bolo' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="bell-ring" class="w-5 h-5 mr-3"></i> BOLO</a>
                        </div>
                    </div>
                    <div>
                        <button data-category="dokumentacja" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>DOKUMENTACJA</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-dokumentacja" class="category-content mt-1 space-y-1 pl-4">
                             <a href="formulas.html" class="sidebar-link ${activePage === 'formulas' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="file-text" class="w-5 h-5 mr-3"></i> Formułki</a>
                             <a href="stroje.html" class="sidebar-link ${activePage === 'stroje' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="shirt" class="w-5 h-5 mr-3"></i> Stroje</a>
                             <a href="dywizje.html" class="sidebar-link ${activePage === 'dywizje' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="users" class="w-5 h-5 mr-3"></i> Dywizje</a>
                        </div>
                    </div>
                    <div>
                        <button data-category="narzedzia" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-gray-400 hover:text-white p-2 rounded-lg">
                            <span>NARZĘDZIA</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-narzedzia" class="category-content mt-1 space-y-1 pl-4">
                             <a href="godziny.html" class="sidebar-link ${activePage === 'godziny' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="clock" class="w-5 h-5 mr-3"></i> Godziny</a>
                             <a href="urlopy.html" class="sidebar-link ${activePage === 'urlopy' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="calendar-days" class="w-5 h-5 mr-3"></i> Urlopy</a>
                             <a href="odznaki.html" class="sidebar-link ${activePage === 'odznaki' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="badge" class="w-5 h-5 mr-3"></i> Odznaki</a>
                             <a href="reports.html" class="sidebar-link ${activePage === 'reports' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="file-check" class="w-5 h-5 mr-3"></i> Raporty</a>
                        </div>
                    </div>
                    ${userData.isAdmin ? `
                    <div>
                        <button data-category="admin" class="category-btn w-full flex items-center justify-between text-sm font-semibold text-red-400 hover:text-red-300 p-2 rounded-lg">
                            <span>ADMINISTRACJA</span>
                            <i data-lucide="chevron-down" class="chevron-icon w-4 h-4 transition-transform"></i>
                        </button>
                        <div id="category-admin" class="category-content mt-1 space-y-1 pl-4">
                             <a href="admin-panel.html" class="sidebar-link ${activePage === 'admin-panel' ? 'active bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-700'} flex items-center px-3 py-2 rounded-lg text-sm"><i data-lucide="user-cog" class="w-5 h-5 mr-3"></i> Panel Admina</a>
                        </div>
                    </div>
                    ` : ''}
                </nav>
                <div class="mt-auto">
                    <div class="border-t border-gray-700 pt-4">
                        <p id="user-display-name" class="text-sm font-semibold text-white">${userData.username}</p>
                        <p id="user-display-rank" class="text-xs text-gray-400">[${userData.badge}] - ${userData.rank}</p>
                    </div>
                    <a href="#" id="logout-button" class="sidebar-link flex items-center mt-2 px-4 py-3 rounded-lg text-gray-400 hover:bg-red-800 hover:text-white">
                        <i data-lucide="log-out" class="w-5 h-5 mr-3"></i> Wyloguj się
                    </a>
                </div>
            `;
            
            sidebarContainer.innerHTML = sidebarHTML;
            
            // Obsługa wylogowania
            document.getElementById('logout-button').addEventListener('click', (e) => {
                e.preventDefault();
                clearAuthSession();
                window.location.href = 'index.html';
            });
            
            // Obsługa rozwijanego menu (zachowanie stanu)
            const openCategories = JSON.parse(sessionStorage.getItem('openCategories')) || [];
            document.querySelectorAll('.category-btn').forEach(button => {
                const categoryId = button.dataset.category;
                const content = document.getElementById(`category-${categoryId}`);
                const icon = button.querySelector('.chevron-icon');
                const hasActiveLink = content.querySelector('.sidebar-link.active');

                // Przywracanie stanu otwarcia
                if (openCategories.includes(categoryId) || hasActiveLink) {
                    content.style.display = 'block';
                    icon.classList.add('rotate-180');
                    if (hasActiveLink && !openCategories.includes(categoryId)) {
                        openCategories.push(categoryId);
                        sessionStorage.setItem('openCategories', JSON.stringify(openCategories));
                    }
                } else {
                    content.style.display = 'none';
                }

                // Kliknięcie w kategorię
                button.addEventListener('click', () => {
                    const isOpen = content.style.display === 'block';
                    content.style.display = isOpen ? 'none' : 'block';
                    icon.classList.toggle('rotate-180', !isOpen);
                    
                    let currentlyOpen = JSON.parse(sessionStorage.getItem('openCategories')) || [];
                    if (!isOpen) { 
                        if (!currentlyOpen.includes(categoryId)) currentlyOpen.push(categoryId);
                    } else { 
                        const index = currentlyOpen.indexOf(categoryId);
                        if (index > -1) currentlyOpen.splice(index, 1);
                    }
                    sessionStorage.setItem('openCategories', JSON.stringify(currentlyOpen));
                });
            });
            lucide.createIcons();
        }
        
        showTimeNotification();
        return userData;

    } catch (error) {
        console.error("Błąd weryfikacji:", error);
        clearAuthSession();
        window.location.href = 'index.html';
        return null;
    }
}

// ================================================================
// DODATKOWE FUNKCJE UI
// ================================================================

function showTimeNotification() {
    if (sessionStorage.getItem('notificationShown')) return;
    if (document.getElementById('time-notification-modal')) return;
    
    const modalHTML = `
        <div id="time-notification-modal" class="modal-backdrop fixed inset-0 z-50 justify-center items-center">
            <div class="bg-gray-800 rounded-lg shadow-xl w-full max-w-lg p-6 text-center border-2 border-amber-400">
                <h2 class="text-2xl font-bold text-amber-300 mb-4 flex items-center justify-center">
                    <i data-lucide="clock" class="w-6 h-6 mr-3"></i>Powiadomienie
                </h2>
                <p class="text-gray-300 mb-6 text-lg">Pamiętajcie o rozpoczynaniu i zakańczaniu służby na #godziny-pracy</p>
                <button id="close-notification-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Zamknij</button>
            </div>
        </div>
    `;
    const styles = `.modal-backdrop { display: none; background-color: rgba(0, 0, 0, 0.7); } .modal-backdrop.flex { display: flex; }`;
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('time-notification-modal');
    const closeBtn = document.getElementById('close-notification-btn');
    closeBtn.addEventListener('click', () => modal.classList.remove('flex'));
    
    const currentHour = new Date().getHours();
    if (currentHour >= 19 && currentHour < 24) {
        modal.classList.add('flex');
        lucide.createIcons();
        sessionStorage.setItem('notificationShown', 'true');
    }
}

function setupCitizenAutocomplete(inputElement, suggestionsContainer, allCitizens) {
    const showSuggestions = () => {
        const query = inputElement.value.toLowerCase();
        if (query.startsWith('<@') && query.endsWith('>')) { suggestionsContainer.classList.add('hidden'); return; }
        if (query.length < 2) { suggestionsContainer.classList.add('hidden'); return; }
        
        const filtered = allCitizens.filter(c => c.name && c.name.toLowerCase().includes(query));
        suggestionsContainer.innerHTML = '';
        
        if (filtered.length > 0) {
            filtered.slice(0, 5).forEach(citizen => {
                const div = document.createElement('div');
                div.className = 'p-2 hover:bg-gray-500 cursor-pointer text-sm';
                div.textContent = `${citizen.name} (${citizen.discordId})`;
                div.addEventListener('mousedown', (e) => { 
                    e.preventDefault(); 
                    inputElement.value = `<@${citizen.discordId}>`; 
                    suggestionsContainer.classList.add('hidden'); 
                    // Trigger input event to validation
                    inputElement.dispatchEvent(new Event('input'));
                });
                suggestionsContainer.appendChild(div);
            });
            suggestionsContainer.classList.remove('hidden');
        } else {
            suggestionsContainer.classList.add('hidden');
        }
    };
    
    const hideSuggestions = () => setTimeout(() => suggestionsContainer.classList.add('hidden'), 150);
    inputElement.addEventListener('input', showSuggestions);
    inputElement.addEventListener('focus', showSuggestions);
    inputElement.addEventListener('blur', hideSuggestions);
}

// Eksportuj funkcje do globalnego zakresu
window.checkAuth = checkAuth;
window.loadSidebarAndUserData = loadSidebarAndUserData;
window.clearAuthSession = clearAuthSession;