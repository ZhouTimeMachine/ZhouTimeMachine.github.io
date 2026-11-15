# Publish the web export at /jvt/ while preserving its relative asset URLs.
module Jekyll
  class JvtPublicFile < StaticFile
    def url
      super.sub(%r{\A/?jvt/project_page/}, "/jvt/")
    end
  end

  class JvtPageGenerator < Generator
    safe true
    priority :highest

    def generate(site)
      site.static_files.map! do |file|
        if file.relative_path.match?(%r{\A/?jvt/project_page/})
          JvtPublicFile.new(site, site.source, File.dirname(file.relative_path), file.name)
        else
          file
        end
      end
    end
  end
end
