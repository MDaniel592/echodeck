# Changelog

## [1.3.4](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.3.3...echodeck-v1.3.4) (2026-02-17)


### Bug Fixes

* **ci:** update docker guardrails for minimal prisma runtime ([#29](https://github.com/MDaniel592/echodeck/issues/29)) ([9bc1e4e](https://github.com/MDaniel592/echodeck/commit/9bc1e4e09d3670fff177276d31feabc496f2092d))

## [1.3.3](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.3.2...echodeck-v1.3.3) (2026-02-17)


### Performance

* **docker:** minimize runtime deps and lock prisma install versions ([#27](https://github.com/MDaniel592/echodeck/issues/27)) ([4970a84](https://github.com/MDaniel592/echodeck/commit/4970a84d533c18fa781c48e6ed9a1f0858dcb91d))

## [1.3.2](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.3.1...echodeck-v1.3.2) (2026-02-17)


### Performance

* **lyrics:** parallelize fallbacks and tighten lookup timeouts ([#24](https://github.com/MDaniel592/echodeck/issues/24)) ([80e9fce](https://github.com/MDaniel592/echodeck/commit/80e9fce9f5ed824da1885bfcfe68581d533f97ec))

## [1.3.1](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.3.0...echodeck-v1.3.1) (2026-02-17)


### Bug Fixes

* pass downloader build args in release docker workflow ([#19](https://github.com/MDaniel592/echodeck/issues/19)) ([7343eba](https://github.com/MDaniel592/echodeck/commit/7343ebafef8b47f348e27f5236b2a3b709630e4f))

## [1.3.0](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.2.1...echodeck-v1.3.0) (2026-02-17)


### Features

* fetch missing lyrics with fallback providers ([#17](https://github.com/MDaniel592/echodeck/issues/17)) ([39009f3](https://github.com/MDaniel592/echodeck/commit/39009f33a2d3e820d63b671236ea1cd193c00313))
* player UX redesign and main page refresh ([#6](https://github.com/MDaniel592/echodeck/issues/6)) ([f89813c](https://github.com/MDaniel592/echodeck/commit/f89813ca7276fcb464f03365b85674f778331af9))


### Bug Fixes

* include pending docker/prisma hardening updates ([7ff103d](https://github.com/MDaniel592/echodeck/commit/7ff103d0b75d3c8bcf931b09a490f7feb026a446))
* release performance sweep ([efbab07](https://github.com/MDaniel592/echodeck/commit/efbab071485ce59239bd5b95432a44e0798c81cd))
* **release:** document releasable commit requirement ([6401cd0](https://github.com/MDaniel592/echodeck/commit/6401cd02c279e302cddca2771d12bcb97bc02366))
* **release:** trigger on echodeck tags and support manual dispatch ([6ca39e8](https://github.com/MDaniel592/echodeck/commit/6ca39e8863dc750e9818123f720c057bbe9115a7))
* reproducible Docker setup and Prisma startup guardrails ([#10](https://github.com/MDaniel592/echodeck/issues/10)) ([8b336c1](https://github.com/MDaniel592/echodeck/commit/8b336c157c5bd46271504a0c5a97612d98afe5d7))

## [1.2.1](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.2.0...echodeck-v1.2.1) (2026-02-16)


### Bug Fixes

* include pending docker/prisma hardening updates ([7ff103d](https://github.com/MDaniel592/echodeck/commit/7ff103d0b75d3c8bcf931b09a490f7feb026a446))

## [1.2.0](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.1.2...echodeck-v1.2.0) (2026-02-16)


### Features

* player UX redesign and main page refresh ([#6](https://github.com/MDaniel592/echodeck/issues/6)) ([f89813c](https://github.com/MDaniel592/echodeck/commit/f89813ca7276fcb464f03365b85674f778331af9))


### Bug Fixes

* release performance sweep ([efbab07](https://github.com/MDaniel592/echodeck/commit/efbab071485ce59239bd5b95432a44e0798c81cd))
* **release:** document releasable commit requirement ([6401cd0](https://github.com/MDaniel592/echodeck/commit/6401cd02c279e302cddca2771d12bcb97bc02366))
* **release:** trigger on echodeck tags and support manual dispatch ([6ca39e8](https://github.com/MDaniel592/echodeck/commit/6ca39e8863dc750e9818123f720c057bbe9115a7))
* reproducible Docker setup and Prisma startup guardrails ([#10](https://github.com/MDaniel592/echodeck/issues/10)) ([8b336c1](https://github.com/MDaniel592/echodeck/commit/8b336c157c5bd46271504a0c5a97612d98afe5d7))

## [1.1.2](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.1.1...echodeck-v1.1.2) (2026-02-16)


### Bug Fixes

* reproducible Docker setup and Prisma startup guardrails ([#10](https://github.com/MDaniel592/echodeck/issues/10)) ([8b336c1](https://github.com/MDaniel592/echodeck/commit/8b336c157c5bd46271504a0c5a97612d98afe5d7))

## [1.1.1](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.1.0...echodeck-v1.1.1) (2026-02-16)


### Bug Fixes

* release performance sweep ([efbab07](https://github.com/MDaniel592/echodeck/commit/efbab071485ce59239bd5b95432a44e0798c81cd))

## [1.1.0](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.0.1...echodeck-v1.1.0) (2026-02-16)


### Features

* player UX redesign and main page refresh ([#6](https://github.com/MDaniel592/echodeck/issues/6)) ([f89813c](https://github.com/MDaniel592/echodeck/commit/f89813ca7276fcb464f03365b85674f778331af9))


### Bug Fixes

* **release:** trigger on echodeck tags and support manual dispatch ([6ca39e8](https://github.com/MDaniel592/echodeck/commit/6ca39e8863dc750e9818123f720c057bbe9115a7))

## [1.0.1](https://github.com/MDaniel592/echodeck/compare/echodeck-v1.0.0...echodeck-v1.0.1) (2026-02-15)


### Bug Fixes

* **release:** document releasable commit requirement ([6401cd0](https://github.com/MDaniel592/echodeck/commit/6401cd02c279e302cddca2771d12bcb97bc02366))
