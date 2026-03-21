{{/*
Expand the name of the chart.
*/}}
{{- define "collabmd.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "collabmd.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "collabmd.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "collabmd.labels" -}}
helm.sh/chart: {{ include "collabmd.chart" . }}
{{ include "collabmd.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "collabmd.selectorLabels" -}}
app.kubernetes.io/name: {{ include "collabmd.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "collabmd.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "collabmd.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Primary app container name.
*/}}
{{- define "collabmd.containerName" -}}
{{ include "collabmd.name" . }}
{{- end }}

{{/*
Persistent volume claim name.
*/}}
{{- define "collabmd.persistentVolumeClaimName" -}}
{{- if .Values.persistence.existingClaim }}
{{- .Values.persistence.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "collabmd.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Return chart app image tag.
*/}}
{{- define "collabmd.imageTag" -}}
{{- default .Chart.AppVersion .Values.image.tag }}
{{- end }}

{{/*
PlantUML resource base name.
*/}}
{{- define "collabmd.plantumlFullname" -}}
{{- printf "%s-plantuml" (include "collabmd.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PlantUML selector labels.
*/}}
{{- define "collabmd.plantumlSelectorLabels" -}}
app.kubernetes.io/name: {{ include "collabmd.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: plantuml
{{- end }}

{{/*
Inline chart-managed secret name.
*/}}
{{- define "collabmd.secretName" -}}
{{ include "collabmd.fullname" . }}
{{- end }}
