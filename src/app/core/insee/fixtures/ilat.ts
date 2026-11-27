/**
 * SYNTHETIC fixture (not recorded from the live INSEE API, which was unreachable from the
 * build environment): BDM SDMX-ML shape as read by the legacy parser. Replace by a real recording
 * when the API is reachable. A .ts module rather than an .xml file so the test build needs no
 * custom loader in angular.json.
 */
export default `<?xml version="1.0" encoding="UTF-8"?>
<!--
  SYNTHETIC FIXTURE, NOT RECORDED FROM THE LIVE API (the build environment could not reach api.insee.fr).
  Shape follows the INSEE BDM SDMX-ML "StructureSpecificData" answer of
  https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001617112?lastNObservations=12
  as read by the legacy app (message:DataSet > Series > Obs, newest first). The values are plausible,
  not official: replace this file with a real recording (curl the URL above) when it can be fetched.
-->
<message:StructureSpecificData xmlns:ss="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/structurespecific" xmlns:footer="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message/footer" xmlns:ns1="urn:sdmx:org.sdmx.infomodel.datastructure.DataStructure=FR1:BDM_LOYER(1.0):ObsLevelDim:TIME_PERIOD" xmlns:message="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message" xmlns:common="http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <message:Header>
    <message:ID>SYNTHETIC-001617112</message:ID>
    <message:Test>false</message:Test>
    <message:Prepared>2026-11-27T00:00:00</message:Prepared>
    <message:Sender id="FR1">
      <common:Name xml:lang="fr">Institut national de la statistique et des études économiques</common:Name>
    </message:Sender>
    <message:Source xml:lang="fr">BDM</message:Source>
  </message:Header>
  <message:DataSet ss:dataScope="DataStructure" xsi:type="ns1:DataSetType" ss:structureRef="FR1_BDM_LOYER_1_0">
    <Series IDBANK="001617112" FREQ="T" TITLE_FR="Indice des loyers des activités tertiaires (ILAT) - Base 100 au 1er trimestre 2010" TITLE_EN="Tertiary activities rent index (ILAT) - Base 100 in Q1 2010" LAST_UPDATE="2026-10-30" UNIT_MEASURE="SO" UNIT_MULT="0" REF_AREA="FE" DECIMALS="2">
    <Obs TIME_PERIOD="2026-Q2" OBS_VALUE="138.01" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2026-Q1" OBS_VALUE="136.64" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2025-Q4" OBS_VALUE="135.92" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2025-Q3" OBS_VALUE="134.88" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2025-Q2" OBS_VALUE="133.69" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2025-Q1" OBS_VALUE="132.77" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2024-Q4" OBS_VALUE="132.14" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2024-Q3" OBS_VALUE="131.50" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2024-Q2" OBS_VALUE="130.91" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2024-Q1" OBS_VALUE="130.25" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2023-Q4" OBS_VALUE="129.70" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    <Obs TIME_PERIOD="2023-Q3" OBS_VALUE="129.02" OBS_STATUS="A" OBS_QUAL="DEF" OBS_TYPE="A"/>
    </Series>
  </message:DataSet>
</message:StructureSpecificData>
`;
