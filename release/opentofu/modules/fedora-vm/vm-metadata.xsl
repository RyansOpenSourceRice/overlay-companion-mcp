<?xml version="1.0" ?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output omit-xml-declaration="yes" indent="yes"/>
  <xsl:template match="node()|@*">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
    </xsl:copy>
  </xsl:template>

  <!-- Add metadata to domain -->
  <xsl:template match="/domain">
    <xsl:copy>
      <xsl:apply-templates select="@*"/>
      <metadata>
        <overlay-companion:vm xmlns:overlay-companion="http://overlay-companion-mcp.local">
          <overlay-companion:project>overlay-companion-mcp</overlay-companion:project>
          <overlay-companion:purpose>fedora-silverblue-desktop</overlay-companion:purpose>
          <overlay-companion:managed-by>opentofu</overlay-companion:managed-by>
        </overlay-companion:vm>
      </metadata>
      <xsl:apply-templates select="node()"/>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
