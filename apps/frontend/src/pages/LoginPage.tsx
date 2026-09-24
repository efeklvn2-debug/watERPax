import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { authApi } from '../api/auth'
import { PhlexMark } from '../components/PhlexMark'
import { BrandWordmark } from '../components/BrandWordmark'
import QRCode from 'qrcode'

type Phase = 'credentials' | 'twofa' | 'enroll' | 'recovery'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [phase, setPhase] = useState<Phase>('credentials')
  const [postAuthToken, setPostAuthToken] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [otpauthUrl, setOtpauthUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    if (!otpauthUrl) return
    let cancelled = false
    QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [otpauthUrl])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const outcome = await useAuthStore.getState().login(username, password)

    if (outcome.ok) {
      navigate('/')
      return
    }

    if (outcome.code === '2FA_REQUIRED' || outcome.code === '2FA_ENROLL_REQUIRED') {
      setPostAuthToken(outcome.postAuthToken || '')
      if (outcome.code === '2FA_ENROLL_REQUIRED') {
        setLoading(true)
        const setup = await authApi.setup2fa(outcome.postAuthToken)
        if (setup.error) {
          setError(setup.error.message)
          setLoading(false)
          return
        }
        setTotpSecret((setup.data as any)?.data?.secret || '')
        setOtpauthUrl((setup.data as any)?.data?.otpauthUrl || '')
        setPhase('enroll')
        setLoading(false)
      } else {
        setPhase('twofa')
        setLoading(false)
      }
      return
    }

    setError(useAuthStore.getState().error || 'Invalid credentials')
    setLoading(false)
  }

  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await authApi.verifyLogin2fa(postAuthToken, useRecovery ? undefined : totpCode, useRecovery ? recoveryCode : undefined)
    if (res.error) {
      setError(res.error.message)
      setLoading(false)
      return
    }
    const ok = await useAuthStore.getState().completeLogin()
    setLoading(false)
    if (ok) navigate('/')
  }

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = await authApi.enroll2fa(totpCode, postAuthToken)
    if (res.error) {
      setError(res.error.message)
      setLoading(false)
      return
    }
    setRecoveryCodes((res.data as any)?.data?.recoveryCodes || [])
    setPhase('recovery')
    setLoading(false)
  }

  const handleRecoverySaved = async () => {
    const ok = await useAuthStore.getState().completeLogin()
    if (ok) navigate('/')
  }

  const backToCredentials = () => {
    setPhase('credentials')
    setTotpCode('')
    setRecoveryCode('')
    setUseRecovery(false)
    setError('')
  }

  const copyRecoveryCodes = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n')).catch(() => {})
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden bg-slate-950">
      {/* Atmosphere */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 70% at 50% -10%, rgba(37,99,235,0.45) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(30,64,175,0.25) 0%, transparent 50%), radial-gradient(ellipse 50% 40% at 0% 80%, rgba(59,130,246,0.15) 0%, transparent 45%)'
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 80% at 50% 40%, black, transparent)'
        }}
      />
      {/* Soft orbit rings */}
      <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[720px] rounded-full border border-blue-500/10 pointer-events-none" />
      <div aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full border border-blue-400/10 pointer-events-none" />

      <div className="relative z-10 w-full max-w-[440px]">
        {/* Brand */}
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-[4.5rem] h-[4.5rem] rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-xl shadow-blue-600/40 ring-1 ring-white/15 mb-6">
            <PhlexMark className="w-11 h-11" />
          </div>
          <h1 className="text-white">
            <BrandWordmark size="xl" />
          </h1>
          <p className="text-slate-400 text-base font-medium mt-3 max-w-sm leading-relaxed">
            Enterprise manufacturing management system
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/40 border border-white/20 p-8 sm:p-9">
          {phase === 'credentials' && (
            <>
              <div className="mb-7">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Welcome back</h2>
                <p className="text-slate-500 text-base mt-1.5">Sign in to continue</p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="username" className="block text-sm font-semibold text-slate-700 mb-2">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </span>
                    <input
                      id="username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 text-base border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Enter your username"
                      required
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-11 pr-12 py-3.5 text-base border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Enter your password"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-base font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Signing in…</span>
                    </>
                  ) : (
                    <span>Sign in</span>
                  )}
                </button>
              </form>
            </>
          )}

          {phase === 'twofa' && (
            <>
              <div className="mb-7">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Two-factor verification</h2>
                <p className="text-slate-500 text-base mt-1.5">
                  Enter the 6-digit code from your authenticator app{useRecovery ? ' or your recovery code' : ''}
                </p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleVerifyLogin} className="space-y-4">
                {useRecovery ? (
                  <div>
                    <label htmlFor="recoveryCode" className="block text-sm font-semibold text-slate-700 mb-2">
                      Recovery code
                    </label>
                    <input
                      id="recoveryCode"
                      type="text"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      className="w-full px-4 py-3.5 text-base border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="XXXX-XXXX"
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="totpCode" className="block text-sm font-semibold text-slate-700 mb-2">
                      Verification code
                    </label>
                    <input
                      id="totpCode"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      className="w-full px-4 py-3.5 text-base tracking-[0.5em] text-center border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="••••••"
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-base font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Verifying…</span>
                    </>
                  ) : (
                    <span>Verify</span>
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => setUseRecovery(v => !v)}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-500"
                >
                  {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
                <span className="mx-2 text-slate-300">·</span>
                <button
                  type="button"
                  onClick={backToCredentials}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                >
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {phase === 'enroll' && (
            <>
              <div className="mb-7">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Set up two-factor authentication</h2>
                <p className="text-slate-500 text-base mt-1.5">
                  Super admins must enable 2FA. Scan the QR code with your authenticator app, then enter the 6-digit code.
                </p>
              </div>

              {error && (
                <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-600">{error}</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center mb-6">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Two-factor setup QR code" className="w-[220px] h-[220px] rounded-xl border border-slate-200" />
                ) : (
                  <div className="w-[220px] h-[220px] rounded-xl border border-slate-200 flex items-center justify-center bg-slate-50">
                    <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )}
                <div className="mt-4 w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Manual entry secret</p>
                  <p className="text-sm font-mono text-slate-700 break-all select-all">{totpSecret || '…'}</p>
                </div>
              </div>

              <form onSubmit={handleEnroll} className="space-y-4">
                <div>
                  <label htmlFor="enrollCode" className="block text-sm font-semibold text-slate-700 mb-2">
                    Verification code
                  </label>
                  <input
                    id="enrollCode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    className="w-full px-4 py-3.5 text-base tracking-[0.5em] text-center border border-slate-300 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="••••••"
                    required
                    autoComplete="one-time-code"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-base font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Enabling…</span>
                    </>
                  ) : (
                    <span>Enable 2FA</span>
                  )}
                </button>
              </form>

              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={backToCredentials}
                  className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                >
                  Back to sign in
                </button>
              </div>
            </>
          )}

          {phase === 'recovery' && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Save your recovery codes</h2>
                <p className="text-slate-500 text-base mt-1.5">
                  Each code works only once. Store them somewhere safe — you'll need them if you lose your authenticator app.
                </p>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-2">
                {recoveryCodes.map(code => (
                  <div key={code} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-sm text-slate-700 text-center select-all">
                    {code}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={copyRecoveryCodes}
                className="w-full mb-3 py-3 px-4 border border-slate-300 text-slate-700 text-base font-semibold rounded-xl hover:bg-slate-50 transition-colors"
              >
                Copy all codes
              </button>

              <button
                type="button"
                onClick={handleRecoverySaved}
                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-base font-bold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-lg shadow-blue-600/30 hover:shadow-blue-500/40"
              >
                I've saved them — continue
              </button>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-sm font-medium text-slate-500">
          Powered by <span className="text-slate-300 font-semibold">RareBreed Optimal Solutions</span>
        </p>
      </div>
    </div>
  )
}