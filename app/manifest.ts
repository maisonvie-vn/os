import { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Maison Vie OS',
    short_name: 'MVOS',
    description: 'Hệ thống quản lý vận hành nội bộ Maison Vie',
    start_url: '/home',
    display: 'standalone',
    background_color: '#102B2A',
    theme_color: '#102B2A',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
