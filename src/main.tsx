import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CssBaseline, GlobalStyles, ThemeProvider, createTheme } from '@mui/material'
import '@fontsource-variable/space-grotesk'
import './index.css'
import App from './App.tsx'

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#20d5b8',
    },
    secondary: {
      main: '#f4c95d',
    },
    background: {
      default: '#05060a',
      paper: '#0e1118',
    },
  },
  typography: {
    fontFamily: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
    h3: {
      fontWeight: 600,
      letterSpacing: '-0.5px',
    },
    button: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 18,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          letterSpacing: 0,
        },
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        body: {
          backgroundColor: theme.palette.background.default,
        },
      }} />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
