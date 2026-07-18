# Production release security blockers

The repository does not contain an updater, update-signature verification,
Windows code-signing credentials, artifact publication configuration or CI
secrets. The CI workflow builds an unpacked Windows artifact only; it does not
claim that the artifact is trusted for public distribution.

Before production distribution:

1. Obtain an organization-owned Windows code-signing certificate, preferably
   hardware-backed or supplied by a managed signing service.
2. Keep signing credentials outside the repository and grant the CI release job
   least-privilege access.
3. Sign both installer and application binaries and verify signatures in a clean
   Windows environment.
4. Choose an authenticated update channel. Sign update metadata and artifacts,
   pin the expected publisher, and test downgrade/replay rejection.
5. Separate pull-request CI from privileged release CI; untrusted changes must
   never receive signing or publication secrets.
6. Produce checksums/SBOM, retain build provenance and scan the packaged native
   dependencies.
7. Define a certificate rotation/revocation and emergency update procedure.

Until these controls exist, public auto-update and large-scale distribution are
production blockers rather than implemented features.
