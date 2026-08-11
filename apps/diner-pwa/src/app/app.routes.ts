import { type Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'bienvenida' },
  {
    path: 'bienvenida',
    loadComponent: () => import('./welcome.page').then((m) => m.WelcomePage),
    title: 'ITADAKI',
  },
  {
    path: 'unirse',
    loadComponent: () => import('./join.page').then((m) => m.JoinPage),
    title: 'Unirse a la mesa · ITADAKI',
  },
  {
    path: 'carta',
    loadComponent: () => import('./menu.page').then((m) => m.MenuPage),
    title: 'Carta · ITADAKI',
  },
  {
    // `id` binds straight to the component input via withComponentInputBinding.
    path: 'producto/:id',
    loadComponent: () => import('./product.page').then((m) => m.ProductPage),
    title: 'Producto · ITADAKI',
  },
  {
    path: 'carrito',
    loadComponent: () => import('./cart.page').then((m) => m.CartPage),
    title: 'Carrito · ITADAKI',
  },
  {
    path: 'estado',
    loadComponent: () => import('./tracking.page').then((m) => m.TrackingPage),
    title: 'Estado del pedido · ITADAKI',
  },
  {
    path: 'cuenta',
    loadComponent: () => import('./bill.page').then((m) => m.BillPage),
    title: 'Cuenta · ITADAKI',
  },
  { path: '**', redirectTo: 'bienvenida' },
];
