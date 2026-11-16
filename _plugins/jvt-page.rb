# Publish the web export at /JVT/ while preserving its relative asset URLs.
module Jekyll
  class JvtPublicFile < StaticFile
    def url
      super.sub(%r{\A/?JVT/project_page/}, "/JVT/")
    end
  end

  class JvtPageGenerator < Generator
    safe true
    priority :highest

    def generate(site)
      site.static_files.map! do |file|
        if file.relative_path.match?(%r{\A/?JVT/project_page/})
          JvtPublicFile.new(site, site.source, File.dirname(file.relative_path), file.name)
        else
          file
        end
      end
    end
  end
end
